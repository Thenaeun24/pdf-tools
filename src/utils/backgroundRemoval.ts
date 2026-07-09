/**
 * 브라우저 안에서만 동작하는 배경 제거(누끼) 유틸.
 *
 * - briaai/RMBG-1.4 모델을 transformers.js(WASM/WebGPU)로 실행한다.
 * - 이미지 픽셀은 절대 네트워크로 나가지 않는다. 모델 가중치/런타임만
 *   HuggingFace·jsDelivr CDN 에서 받아 IndexedDB 에 캐시한다(최초 1회).
 * - 결과는 배경이 투명한 PNG Blob.
 */

// transformers.js 타입은 무겁고 정적 export 번들에 불필요하므로 런타임 동적 import.
type Transformers = typeof import('@huggingface/transformers');

let transformersPromise: Promise<Transformers> | null = null;

function loadTransformers(): Promise<Transformers> {
  if (!transformersPromise) {
    transformersPromise = import('@huggingface/transformers').then((mod) => {
      // 로컬 파일 시스템 조회를 끄고 CDN(HF Hub)에서만 모델을 받는다.
      mod.env.allowLocalModels = false;
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
        // WebGPU 는 fp16 가 안정적, WASM 은 fp32.
        dtype: device === 'webgpu' ? 'fp16' : 'fp32',
        progress_callback,
      });
      const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
        config: {
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

    if (supportsWebGPU) {
      try {
        return await build('webgpu');
      } catch (err) {
        // WebGPU 초기화 실패(드라이버/브라우저 편차) 시 WASM 으로 폴백.
        console.warn('[background-removal] WebGPU 실패, WASM 로 폴백합니다.', err);
      }
    }
    return build('wasm');
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
    const { output } = await model({ input: pixel_values });

    // 마스크를 원본 해상도로 리사이즈(0~255 알파).
    const mask = await RawImage.fromTensor(
      output[0].mul(255).to('uint8'),
    ).resize(image.width, image.height);

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
