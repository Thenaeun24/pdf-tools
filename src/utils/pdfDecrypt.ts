import { PDFDocument } from 'pdf-lib';
import type { QpdfInstance } from '@neslinesli93/qpdf-wasm';

/**
 * 비밀번호로 잠긴(암호화된) PDF 를 평문 PDF 로 변환한다.
 *
 * 배경:
 *   - 분할/병합/회전/마크업 등 모든 도구는 pdf-lib(벡터 복사) 또는 pdfjs 로
 *     동작하는데, 둘 다 암호화된 콘텐츠 스트림을 "복호화" 하지는 못한다.
 *     (pdf-lib 의 `ignoreEncryption: true` 는 수정 거부 가드를 건너뛸 뿐
 *      실제 내용을 풀지 못해 결과가 깨진다.)
 *   - 따라서 업로드 경계에서 한 번 qpdf(WASM) 로 비밀번호를 제거해
 *     평문 PDF File 로 바꿔 두면, 이후 모든 도구가 그대로 동작한다.
 *
 * qpdf 는 브라우저에서 오프라인으로 RC4 / AES-128 / AES-256 를 모두 풀 수 있어
 * 벡터/텍스트를 보존한 채 잠금을 해제한다.
 */

type QpdfFactoryArg = {
  locateFile: (path: string, prefix: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  noExitRuntime?: boolean;
};
type QpdfFactory = (arg: QpdfFactoryArg) => Promise<QpdfInstance>;

/**
 * qpdf glue(CommonJS) 는 default 로 Emscripten 팩토리를 내보낸다.
 * pdfjs 와 마찬가지로 브라우저 런타임에서만 동적 로드한다.
 */
let qpdfFactoryPromise: Promise<QpdfFactory> | null = null;

function getQpdfFactory(): Promise<QpdfFactory> {
  if (!qpdfFactoryPromise) {
    qpdfFactoryPromise = import('@neslinesli93/qpdf-wasm').then((mod) => {
      const candidate = (mod as { default?: unknown }).default ?? mod;
      const factory =
        typeof candidate === 'function'
          ? candidate
          : (candidate as { default?: unknown }).default;
      return factory as QpdfFactory;
    });
  }
  return qpdfFactoryPromise;
}

/**
 * 번들러가 emit 한 wasm 자산 URL. pdfjs 워커와 동일하게
 * `new URL(bare-specifier, import.meta.url)` 패턴으로 basePath/assetPrefix 가
 * 반영된 경로를 얻는다.
 */
function locateWasm(): string {
  return new URL(
    '@neslinesli93/qpdf-wasm/dist/qpdf.wasm',
    import.meta.url,
  ).toString();
}

/** Emscripten MEMFS 의 writeFile 은 공개 타입에 빠져 있어 좁혀서 사용한다. */
type WritableFS = QpdfInstance['FS'] & {
  writeFile: (path: string, data: Uint8Array) => void;
};

/**
 * PDF 가 비밀번호(암호화)로 보호되어 있는지 판별.
 * pdf-lib 는 암호화 문서를 `ignoreEncryption` 없이 로드하면
 * EncryptedPDFError 를 던진다. 그 신호만으로 판단한다.
 */
export async function isPdfEncrypted(
  bytes: Uint8Array | ArrayBuffer,
): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { ignoreEncryption: false });
    return false;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);
    return name === 'EncryptedPDFError' || /encrypt/i.test(msg);
  }
}

export type DecryptResult =
  | { status: 'ok'; data: Uint8Array }
  | { status: 'wrong-password' }
  | { status: 'error'; message: string };

/**
 * 주어진 비밀번호로 PDF 를 복호화해 평문 바이트를 돌려준다.
 * 매 호출마다 새 qpdf 인스턴스를 만든다(callMain 이 런타임을 종료시킬 수
 * 있어 재사용이 위험하고, 재시도마다 깨끗한 상태가 필요하기 때문).
 */
export async function decryptPdfBytes(
  bytes: Uint8Array,
  password: string,
): Promise<DecryptResult> {
  const factory = await getQpdfFactory();

  let stderr = '';
  const qpdf = await factory({
    locateFile: () => locateWasm(),
    print: () => {},
    printErr: (text: string) => {
      stderr += `${text}\n`;
    },
    noExitRuntime: true,
  });

  const inputPath = '/input.pdf';
  const outputPath = '/output.pdf';
  const fs = qpdf.FS as WritableFS;
  fs.writeFile(inputPath, bytes);

  // qpdf --password=PW --decrypt input output : 잠금을 제거한 평문 PDF 생성.
  const args = [`--password=${password}`, '--decrypt', inputPath, outputPath];

  let code: number;
  try {
    code = qpdf.callMain(args);
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    code = typeof status === 'number' ? status : 2;
  }

  // qpdf exit code: 0 정상, 3 경고(출력은 생성됨), 2 오류.
  if (code === 0 || code === 3) {
    try {
      const data = qpdf.FS.readFile(outputPath);
      return { status: 'ok', data };
    } catch {
      return { status: 'error', message: '복호화 결과를 읽지 못했습니다.' };
    }
  }

  if (/password|invalid|incorrect/i.test(stderr) || password.length > 0) {
    return { status: 'wrong-password' };
  }
  return {
    status: 'error',
    message: stderr.trim() || 'PDF 잠금 해제에 실패했습니다.',
  };
}

/** requestPassword 콜백: 비밀번호 문자열 또는 null(취소) 을 resolve. */
export type RequestPassword = (ctx: {
  fileName: string;
  retry: boolean;
}) => Promise<string | null>;

function makeDecryptedFile(original: File, data: Uint8Array): File {
  const ab = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  return new File([ab], original.name, {
    type: 'application/pdf',
    lastModified: original.lastModified,
  });
}

/**
 * 업로드된 PDF 한 개를 "바로 쓸 수 있는" 평문 File 로 보장한다.
 *   - 암호화돼 있지 않으면 원본 그대로 반환.
 *   - 소유자(편집) 잠금만 있고 열기 비밀번호가 없으면 빈 비밀번호로 자동 해제.
 *   - 열기 비밀번호가 필요하면 requestPassword 로 입력받아 성공할 때까지 재시도.
 *   - 사용자가 취소하면 null 반환.
 */
export async function ensureDecryptedPdfFile(
  file: File,
  requestPassword: RequestPassword,
): Promise<File | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!(await isPdfEncrypted(bytes))) return file;

  // 1) 열기 비밀번호 없이 소유자 잠금만 걸린 경우: 빈 비밀번호로 조용히 해제.
  const tryEmpty = await decryptPdfBytes(bytes, '');
  if (tryEmpty.status === 'ok') {
    return makeDecryptedFile(file, tryEmpty.data);
  }

  // 2) 열기 비밀번호 필요: 입력 → 시도 반복.
  let retry = false;
  for (;;) {
    const password = await requestPassword({ fileName: file.name, retry });
    if (password == null) return null; // 취소

    const result = await decryptPdfBytes(bytes, password);
    if (result.status === 'ok') {
      return makeDecryptedFile(file, result.data);
    }
    if (result.status === 'error') {
      throw new Error(result.message);
    }
    retry = true; // wrong-password → 다시 입력
  }
}

/**
 * 여러 PDF 를 일괄로 평문화한다. 취소된 파일은 건너뛴다.
 * onCancel 콜백으로 취소된 파일명을 알릴 수 있다.
 */
export async function ensureDecryptedPdfFiles(
  files: File[],
  requestPassword: RequestPassword,
  onCancel?: (file: File) => void,
): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    const decrypted = await ensureDecryptedPdfFile(file, requestPassword);
    if (decrypted) {
      out.push(decrypted);
    } else {
      onCancel?.(file);
    }
  }
  return out;
}
