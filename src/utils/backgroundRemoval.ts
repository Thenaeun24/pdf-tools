/**
 * 브라우저 안에서만 동작하는 배경 제거(누끼) 유틸.
 *
 * - briaai/RMBG-1.4 모델을 transformers.js(WASM/WebGPU)로 실행한다.
 * - 모델 가중치(onnx)와 런타임(wasm)을 외부 CDN(HuggingFace/jsDelivr) 이 아니라
 *   이 사이트가 서빙하는 자체 경로(/models, /ort)에서 로드한다. 그래서 외부망이
 *   막힌 환경에서도 동작하고, 이미지 픽셀은 애초에 네트워크로 나가지 않는다.
 * - 결과는 배경이 투명한 PNG Blob.
 */

// transformers.js 타입은 무겁고 정적 export 번들에 불필요하므로 런타임 동적 import.
type Transformers = typeof import('@huggingface/transformers');

let transformersPromise: Promise<Transformers> | null = null;

/**
 * 현재 페이지 기준 자산 베이스 URL. basePath(예: GitHub Pages 의 /pdf-tools/)
 * 아래에 배포돼도 올바른 절대경로가 나오도록 document.baseURI 로 계산한다.
 */
function assetBase(): string {
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL('./', document.baseURI).href;
  }
  return '/';
}

function loadTransformers(): Promise<Transformers> {
  if (!transformersPromise) {
    transformersPromise = import('@huggingface/transformers').then((mod) => {
      const base = assetBase();
      // 원격(HF) 조회를 끄고, 이 사이트가 서빙하는 로컬 경로에서만 모델을 읽는다.
      mod.env.allowRemoteModels = false;
      mod.env.allowLocalModels = true;
      mod.env.localModelPath = `${base}models/`;
      // ONNX 런타임 wasm 도 jsDelivr 대신 자체 호스팅 경로에서 로드.
      const wasm = mod.env.backends?.onnx?.wasm;
      if (wasm) wasm.wasmPaths = `${base}ort/`;
      return mod;
    });
  }
  return transformersPromise;
}

interface Model {
  model: Awaited<ReturnType<Transformers['AutoModel']['from_pretrained']>>;
  processor: Awaited<ReturnType<Transformers['AutoProcessor']['from_pretrained']>>;
  RawImage: Transformers['RawImage'];
}

const MODEL_ID = 'briaai/RMBG-1.4';

let modelPromise: Promise<Model> | null = null;

/** 실제 추론에 사용 중인 연산장치. 로드 성공 후 확정된다. */
let activeDevice: 'webgpu' | 'wasm' | null = null;

/** 실제로 사용된 연산장치('webgpu'=GPU 가속 / 'wasm'=CPU). 로드 전엔 null. */
export function getActiveDevice(): 'webgpu' | 'wasm' | null {
  return activeDevice;
}

/**
 * 조각으로 나눠 올린 model.onnx 를 받아 하나로 합쳐 Response 로 돌려준다.
 * (Cloudflare Pages 의 파일당 25MB 제한 때문에 모델을 분할 배포한다.)
 */
async function assembleSplitModel(
  modelUrl: string,
  fetchFn: typeof fetch,
): Promise<Response> {
  const dir = modelUrl.slice(0, modelUrl.lastIndexOf('/') + 1); // .../onnx/
  const manifestRes = await fetchFn(`${dir}model.parts.json`);
  if (!manifestRes.ok) {
    throw new Error(`매니페스트 로드 실패 (${manifestRes.status})`);
  }
  const manifest = (await manifestRes.json()) as { parts: string[] };
  const buffers: ArrayBuffer[] = [];
  for (const name of manifest.parts) {
    const res = await fetchFn(`${dir}${name}`);
    if (!res.ok) throw new Error(`모델 조각 ${name} 로드 실패 (${res.status})`);
    buffers.push(await res.arrayBuffer());
  }
  const blob = new Blob(buffers, { type: 'application/octet-stream' });
  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(blob.size),
    },
  });
}

/**
 * fn 실행 동안 fetch 를 감싼다.
 * - 분할된 model.onnx 요청은 조각을 받아 합쳐서 응답.
 * - 그 외 네트워크 오류에는 어떤 URL 이 막혔는지 메시지에 붙인다(진단용).
 * 끝나면 원래 fetch 로 복원.
 */
async function withModelFetch<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof globalThis.fetch !== 'function') return fn();
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    // 분할 모델 요청을 가로채 조각을 합쳐 응답한다.
    // (쿼리/해시 제거 후 경로로 판별 → model.onnx.partN 은 매칭되지 않음)
    const path = url.split('?')[0].split('#')[0];
    if (path.endsWith('/onnx/model.onnx')) {
      try {
        return await assembleSplitModel(path, original);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(`모델 조립 실패 (${reason}): ${url}`);
      }
    }
    try {
      return await original(input, init);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`네트워크 요청 실패 (${reason}): ${url}`);
    }
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

export interface LoadProgress {
  /** 0 ~ 100. 모델 가중치 다운로드 진행률(대략치). */
  percent: number;
  status: string;
}

/**
 * 모델을 로드(최초 1회 다운로드)한다. 이후 호출은 캐시된 인스턴스를 즉시 반환.
 * WebGPU 지원 환경이면 GPU 로, 아니면 WASM(CPU) 로 자동 폴백한다.
 */
export function loadModel(
  onProgress?: (p: LoadProgress) => void,
): Promise<Model> {
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    const t = await loadTransformers();
    const { AutoModel, AutoProcessor, RawImage } = t;

    const progress_callback = (data: {
      status: string;
      progress?: number;
      file?: string;
    }) => {
      if (!onProgress) return;
      onProgress({
        percent:
          typeof data.progress === 'number'
            ? Math.round(data.progress)
            : data.status === 'ready'
              ? 100
              : 0,
        status: data.status,
      });
    };

    const supportsWebGPU =
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      (navigator as Navigator & { gpu?: unknown }).gpu != null;

    async function build(device: 'webgpu' | 'wasm') {
      const model = await AutoModel.from_pretrained(MODEL_ID, {
        // RMBG-1.4 는 커스텀 아키텍처라 model_type 을 명시해야 한다.
        config: { model_type: 'custom' } as never,
        device,
        // 자체 호스팅한 모델은 fp32(model.onnx) 한 종류라 dtype 고정.
        dtype: 'fp32',
        progress_callback,
      });
      const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
        config: {
          // RMBG-1.4 레포에는 transformers.js 용 preprocessor 설정이 없어서
          // feature_extractor_type 을 명시하지 않으면 프로세서 생성이 실패한다.
          feature_extractor_type: 'ImageFeatureExtractor',
          do_normalize: true,
          do_pad: false,
          do_rescale: true,
          do_resize: true,
          image_mean: [0.5, 0.5, 0.5],
          image_std: [1, 1, 1],
          resample: 2,
          rescale_factor: 0.00392156862745098,
          size: { width: 1024, height: 1024 },
        } as never,
        progress_callback,
      });
      return { model, processor, RawImage };
    }

    return withModelFetch(async () => {
      if (supportsWebGPU) {
        try {
          const built = await build('webgpu');
          activeDevice = 'webgpu';
          return built;
        } catch (err) {
          // WebGPU 초기화 실패(드라이버/브라우저 편차) 시 WASM 으로 폴백.
          console.warn(
            '[background-removal] WebGPU 실패, WASM 로 폴백합니다.',
            err,
          );
        }
      }
      const built = await build('wasm');
      activeDevice = 'wasm';
      return built;
    });
  })();

  return modelPromise;
}

/** WebGPU 로 가속 가능한 환경인지(대략적인 사전 안내용). */
export function isWebGPUAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'gpu' in navigator &&
    (navigator as Navigator & { gpu?: unknown }).gpu != null
  );
}

/**
 * 이미지 파일의 배경을 제거하고 투명 PNG Blob 을 반환한다.
 * @param file  원본 이미지 파일
 * @param onLoadProgress  모델 최초 다운로드 진행 콜백(캐시되면 호출 거의 없음)
 */
export async function removeBackground(
  file: File,
  onLoadProgress?: (p: LoadProgress) => void,
): Promise<Blob> {
  const { model, processor, RawImage } = await loadModel(onLoadProgress);

  const url = URL.createObjectURL(file);
  try {
    const image = await RawImage.fromURL(url);

    // 전처리 → 추론 → 마스크 추출
    const { pixel_values } = await processor(image);
    const result = (await model({ input: pixel_values })) as Record<
      string,
      unknown
    >;

    // ONNX 출력 이름이 'output' 이 아닐 수 있으므로 방어적으로 첫 텐서를 고른다.
    type Tensorish = {
      mul: (n: number) => Tensorish;
      to: (t: string) => Tensorish;
      [index: number]: Tensorish;
    };
    const isTensor = (v: unknown): v is Tensorish =>
      !!v && typeof (v as { mul?: unknown }).mul === 'function';

    const outputTensor: Tensorish | undefined = isTensor(result.output)
      ? result.output
      : (Object.values(result).find(isTensor) as Tensorish | undefined);

    if (!outputTensor) {
      throw new Error(
        `모델 출력 형식을 해석하지 못했습니다: ${Object.keys(result).join(', ')}`,
      );
    }

    // 배치 차원[0] 을 제거한 뒤 0~255 알파 마스크로 변환, 원본 해상도로 리사이즈.
    const maskTensor = outputTensor[0].mul(255).to('uint8');
    const mask = await RawImage.fromTensor(maskTensor as never).resize(
      image.width,
      image.height,
    );

    // 원본을 캔버스에 그리고 알파 채널을 마스크로 교체.
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스 컨텍스트를 생성하지 못했습니다.');

    const bitmap = await createImageBitmap(file);
    ctx.drawImage(bitmap, 0, 0, image.width, image.height);
    bitmap.close();

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const pixels = imageData.data;
    const maskData = mask.data;
    for (let i = 0; i < maskData.length; i++) {
      pixels[i * 4 + 3] = maskData[i];
    }
    ctx.putImageData(imageData, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG 인코딩에 실패했습니다.'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
