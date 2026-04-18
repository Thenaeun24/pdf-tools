import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import type * as PdfjsLibType from 'pdfjs-dist';
import type { DrawingAction, ImageFormat, ImageScale } from '@/types';

/**
 * `pdfjs-dist`는 브라우저 전용 모듈이라 top-level import 시 Next.js
 * static export(SSG) 단계에서 `DOMMatrix is not defined` 에러가 발생한다.
 * 따라서 클라이언트 런타임에서만 동적 로드한다.
 */
let pdfjsLibPromise: Promise<typeof PdfjsLibType> | null = null;

function getPdfJs(): Promise<typeof PdfjsLibType> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist').then((mod) => {
      if (
        typeof window !== 'undefined' &&
        !mod.GlobalWorkerOptions.workerSrc
      ) {
        mod.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
      }
      return mod;
    });
  }
  return pdfjsLibPromise;
}

export interface PdfPageImage {
  pageNumber: number;
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
}

/* -------------------------------------------------------------------------- */
/*                              Internal helpers                              */
/* -------------------------------------------------------------------------- */

/**
 * 정규화(0~1) 좌표 배열을 단일 SVG path 문자열로 변환한다.
 * - Canvas 프리뷰의 strokeFree 와 동일하게 인접한 두 점의 중점을 Quadratic Bezier
 *   의 끝점으로, 현재 점을 control point 로 삼아 부드러운 곡선을 만든다.
 * - 한 번의 path 로 그려야 세그먼트 경계마다 round cap 이 중첩되어 생기는
 *   진한 경계(형광펜 "음영")를 피할 수 있다.
 */
function buildSmoothSvgPath(
  pts: { x: number; y: number }[],
  pw: number,
  ph: number,
): string {
  if (pts.length < 2) return '';
  const cmds: string[] = [];
  const first = pts[0];
  cmds.push(`M ${(first.x * pw).toFixed(3)} ${(first.y * ph).toFixed(3)}`);

  if (pts.length === 2) {
    const last = pts[1];
    cmds.push(`L ${(last.x * pw).toFixed(3)} ${(last.y * ph).toFixed(3)}`);
    return cmds.join(' ');
  }

  for (let i = 1; i < pts.length - 1; i++) {
    const cur = pts[i];
    const next = pts[i + 1];
    const midX = ((cur.x + next.x) / 2) * pw;
    const midY = ((cur.y + next.y) / 2) * ph;
    cmds.push(
      `Q ${(cur.x * pw).toFixed(3)} ${(cur.y * ph).toFixed(3)} ${midX.toFixed(
        3,
      )} ${midY.toFixed(3)}`,
    );
  }
  const last = pts[pts.length - 1];
  cmds.push(`L ${(last.x * pw).toFixed(3)} ${(last.y * ph).toFixed(3)}`);
  return cmds.join(' ');
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return await file.arrayBuffer();
}

async function loadPdfDocument(file: File) {
  const pdfjsLib = await getPdfJs();
  const data = await readFileAsArrayBuffer(file);
  const loadingTask = pdfjsLib.getDocument({
    data,
    isEvalSupported: false, // CSP/보안 위해 반드시 false
    useWorkerFetch: false,
    disableAutoFetch: true,
  });
  return await loadingTask.promise;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('캔버스 변환 실패'))),
      type,
      quality,
    );
  });
}

/* -------------------------------------------------------------------------- */
/*                             pdfToImages 구현                                */
/* -------------------------------------------------------------------------- */

/**
 * PDF 각 페이지를 이미지로 변환.
 */
export async function pdfToImages(
  file: File,
  format: ImageFormat,
  scale: ImageScale,
  onProgress?: (current: number, total: number) => void,
): Promise<PdfPageImage[]> {
  const pdf = await loadPdfDocument(file);
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = format === 'jpeg' ? 0.92 : undefined;

  const results: PdfPageImage[] = [];
  const total = pdf.numPages;

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context 획득 실패');

    if (format === 'jpeg') {
      // JPEG는 투명도 미지원 → 배경 흰색으로
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // pdfjs v5: render 인자 타입 변동이 있어 캐스팅 처리
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    } as unknown as Parameters<typeof page.render>[0]).promise;

    const dataUrl = canvas.toDataURL(mimeType, quality);
    const blob = await canvasToBlob(canvas, mimeType, quality);

    results.push({
      pageNumber: pageNum,
      dataUrl,
      blob,
      width: canvas.width,
      height: canvas.height,
    });

    page.cleanup();
    onProgress?.(pageNum, total);
  }

  await pdf.destroy();
  return results;
}

/* -------------------------------------------------------------------------- */
/*                             imagesToPdf 구현                                */
/* -------------------------------------------------------------------------- */

/**
 * 여러 이미지를 한 개의 PDF로 합침. 각 이미지가 곧 한 페이지.
 */
export async function imagesToPdf(files: File[]): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = (file.type || '').toLowerCase();
    const name = file.name.toLowerCase();

    let embedded;
    if (type.includes('png') || name.endsWith('.png')) {
      embedded = await pdfDoc.embedPng(bytes);
    } else if (
      type.includes('jpeg') ||
      type.includes('jpg') ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg')
    ) {
      embedded = await pdfDoc.embedJpg(bytes);
    } else {
      // 알 수 없는 타입(WebP 등) → Canvas로 PNG 재인코딩 후 embedPng
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('이미지 읽기 실패'));
        reader.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('이미지 로드 실패'));
        el.src = dataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context 획득 실패');
      ctx.drawImage(img, 0, 0);
      const pngDataUrl = canvas.toDataURL('image/png');
      embedded = await pdfDoc.embedPng(pngDataUrl);
    }

    const page = pdfDoc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });
  }

  const pdfBytes = await pdfDoc.save();
  // Uint8Array → ArrayBuffer 안전 복사 (SharedArrayBuffer 타입 충돌 방지)
  const arrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: 'application/pdf' });
}

/* -------------------------------------------------------------------------- */
/*                   2회차 구현 (병합 / 분할 / 회전 / 썸네일)                    */
/* -------------------------------------------------------------------------- */

/**
 * PDF의 페이지 개수를 반환.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * 여러 PDF를 주어진 순서대로 이어붙인다.
 */
export async function mergePdfs(
  files: File[],
  onProgress?: (current: number, total: number) => void,
): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('병합할 PDF가 없습니다.');

  const out = await PDFDocument.create();
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const bytes = await files[i].arrayBuffer();
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = src.getPageIndices();
    const copied = await out.copyPages(src, indices);
    copied.forEach((p) => out.addPage(p));
    onProgress?.(i + 1, total);
  }

  return await out.save();
}

/**
 * 지정된 페이지 범위들로 PDF를 분할. 각 범위가 하나의 결과 PDF가 된다.
 * range는 1-based, start/end 포함(inclusive).
 */
export async function splitPdf(
  file: File,
  ranges: { start: number; end: number }[],
): Promise<{ data: Uint8Array; name: string }[]> {
  const bytes = await file.arrayBuffer();
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  const baseName = file.name.replace(/\.pdf$/i, '') || 'document';

  const results: { data: Uint8Array; name: string }[] = [];

  for (const range of ranges) {
    const start = Math.max(1, Math.floor(range.start));
    const end = Math.min(totalPages, Math.floor(range.end));
    if (start > end) continue;

    const out = await PDFDocument.create();
    const indices: number[] = [];
    for (let i = start; i <= end; i++) indices.push(i - 1);
    const copied = await out.copyPages(src, indices);
    copied.forEach((p) => out.addPage(p));

    const data = await out.save();
    const name =
      start === end
        ? `${baseName}_p${start}.pdf`
        : `${baseName}_p${start}-${end}.pdf`;
    results.push({ data, name });
  }

  return results;
}

/**
 * 각 페이지를 1장짜리 PDF로 분할한다.
 */
export async function splitPdfByPage(
  file: File,
): Promise<{ data: Uint8Array; name: string }[]> {
  const bytes = await file.arrayBuffer();
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const baseName = file.name.replace(/\.pdf$/i, '') || 'document';

  const results: { data: Uint8Array; name: string }[] = [];
  for (let i = 0; i < total; i++) {
    const out = await PDFDocument.create();
    const [copied] = await out.copyPages(src, [i]);
    out.addPage(copied);
    const data = await out.save();
    results.push({ data, name: `${baseName}_p${i + 1}.pdf` });
  }
  return results;
}

/**
 * 페이지별 회전 적용. rotations의 key=0-based pageIndex, value=추가 회전(도, 90단위).
 * 원본 PDF의 기존 회전값에 delta를 더한 뒤 360으로 정규화해 저장.
 */
export async function rotatePdfPages(
  file: File,
  rotations: Map<number, number>,
): Promise<Uint8Array> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();

  pages.forEach((page, idx) => {
    const delta = rotations.get(idx) ?? 0;
    if (!delta) return;
    const current = page.getRotation().angle || 0;
    const next = (((current + delta) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  });

  return await doc.save();
}

/**
 * 특정 페이지를 작은 이미지 썸네일(data URL PNG)로 렌더링.
 * pageIndex는 0-based.
 */
export async function generatePageThumbnail(
  file: File,
  pageIndex: number,
  scale = 0.3,
): Promise<string> {
  const pdf = await loadPdfDocument(file);
  try {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context 획득 실패');

    // 투명한 PNG 대신 흰 배경으로 렌더링해서 보기 좋게.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    } as unknown as Parameters<typeof page.render>[0]).promise;

    const dataUrl = canvas.toDataURL('image/png');
    page.cleanup();
    return dataUrl;
  } finally {
    await pdf.destroy();
  }
}

/* -------------------------------------------------------------------------- */
/*                     PdfMerge STEP2 전용: 페이지 조립 헬퍼                     */
/* -------------------------------------------------------------------------- */

export interface AssemblyPage {
  sourceFileId: string;
  pageIndex: number; // 0-based
  rotation: number; // 추가 회전(도, 90단위)
}

/**
 * 임의의 소스 PDF들에서 페이지 단위로 골라 하나의 PDF로 조립.
 * - pages 순서대로 출력
 * - 각 페이지에 rotation(추가 회전)을 합산 적용
 */
export async function assemblePdfFromPages(
  pages: AssemblyPage[],
  sources: Map<string, File>,
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('페이지가 없습니다.');

  const out = await PDFDocument.create();
  const docCache = new Map<string, PDFDocument>();

  for (const page of pages) {
    let src = docCache.get(page.sourceFileId);
    if (!src) {
      const srcFile = sources.get(page.sourceFileId);
      if (!srcFile) {
        throw new Error(`소스 파일을 찾을 수 없습니다: ${page.sourceFileId}`);
      }
      const bytes = await srcFile.arrayBuffer();
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      docCache.set(page.sourceFileId, src);
    }

    const [copied] = await out.copyPages(src, [page.pageIndex]);
    if (page.rotation) {
      const current = copied.getRotation().angle || 0;
      const next = (((current + page.rotation) % 360) + 360) % 360;
      copied.setRotation(degrees(next));
    }
    out.addPage(copied);
  }

  return await out.save();
}

/* -------------------------------------------------------------------------- */
/*                       3회차 구현 (마크업 / 페이지 렌더)                       */
/* -------------------------------------------------------------------------- */

/**
 * PDF의 특정 페이지를 주어진 Canvas에 렌더링한다.
 * canvas.width/height는 viewport × scale 크기로 자동 설정된다.
 * CSP 때문에 반드시 isEvalSupported:false.
 */
export async function renderPdfPageToCanvas(
  file: File,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale = 1.5,
): Promise<void> {
  const pdf = await loadPdfDocument(file);
  try {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context 획득 실패');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    } as unknown as Parameters<typeof page.render>[0]).promise;
    page.cleanup();
  } finally {
    await pdf.destroy();
  }
}

/* ---------- 마크업 적용 헬퍼 ---------- */

function hexToPdfRgb(hex: string) {
  const clean = hex.replace('#', '').trim();
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  );
}

function hasNonAsciiText(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) return true;
  }
  return false;
}

/**
 * 한글/유니코드 텍스트를 Canvas에 그려 PNG data URL로 반환.
 * pdf-lib의 StandardFonts는 WinAnsi 외 문자를 지원하지 못하므로 이미지로 대체한다.
 */
function renderTextToPng(
  content: string,
  cssFontSizePt: number,
  color: string,
): { dataUrl: string; widthPt: number; heightPt: number } {
  const pxScale = 2; // backing scale for crispness
  const fontSizePx = Math.max(4, Math.round(cssFontSizePt * pxScale));
  const fontFamily =
    "-apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif";

  const measure = document.createElement('canvas');
  const mctx = measure.getContext('2d');
  if (!mctx) throw new Error('Canvas 2D context 획득 실패');
  mctx.font = `${fontSizePx}px ${fontFamily}`;
  const metrics = mctx.measureText(content);
  const widthPx = Math.max(1, Math.ceil(metrics.width + fontSizePx * 0.2));
  const heightPx = Math.max(1, Math.ceil(fontSizePx * 1.3));

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context 획득 실패');
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.font = `${fontSizePx}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(content, fontSizePx * 0.1, fontSizePx * 0.1);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthPt: widthPx / pxScale,
    heightPt: heightPx / pxScale,
  };
}

/**
 * Canvas 기반 마크업(DrawingAction[])을 원본 PDF에 구워 넣는다.
 * - 좌표: DrawingAction의 points/rect/text는 0~1 정규화된 좌표 (Canvas top-left 원점).
 * - lineWidth/fontSize는 각각 canvas.width/canvas.height에 대한 0~1 비율.
 * - PDF 좌표계는 좌하단 원점이므로 Y축을 뒤집어 변환한다.
 */
export async function applyMarkupToPdf(
  file: File,
  actions: DrawingAction[],
): Promise<Uint8Array> {
  const bytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  // Helvetica는 ASCII 텍스트에만 사용. 필요 시 lazy embed.
  let helveticaPromise: Promise<Awaited<ReturnType<typeof pdfDoc.embedFont>>> | null = null;
  const getHelvetica = () => {
    if (!helveticaPromise) {
      helveticaPromise = pdfDoc.embedFont(StandardFonts.Helvetica);
    }
    return helveticaPromise;
  };

  // 페이지별로 그룹화
  const byPage = new Map<number, DrawingAction[]>();
  for (const a of actions) {
    const arr = byPage.get(a.page);
    if (arr) arr.push(a);
    else byPage.set(a.page, [a]);
  }

  for (const [pageIdx, pageActions] of byPage) {
    const page = pages[pageIdx];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();

    // 정규화 → PDF 좌표 변환
    const nxToPdfX = (nx: number) => nx * pw;
    const nyToPdfY = (ny: number) => ph * (1 - ny); // Y 뒤집기

    for (const action of pageActions) {
      const color = hexToPdfRgb(action.style.color);
      const opacity = Math.max(0, Math.min(1, action.style.opacity ?? 1));

      switch (action.tool) {
        case 'highlight-free': {
          const pts = action.points;
          if (!pts || pts.length < 2) break;
          const thickness = Math.max(0.1, (action.style.lineWidth || 0) * pw);
          // 세그먼트별 drawLine 은 이음매마다 round cap 이 중첩되어 진한 경계가
          // 생기고, 각 세그먼트가 개별 alpha 로 합성되며 자기 중첩이 누적된다.
          // 따라서 전체 획을 하나의 SVG path(중점 Quadratic Bezier) 로 그리고,
          // Multiply 블렌드 + 단일 borderOpacity 로 형광펜 느낌을 살린다.
          const svgPath = buildSmoothSvgPath(pts, pw, ph);
          if (!svgPath) break;
          page.drawSvgPath(svgPath, {
            x: 0,
            y: ph,
            borderColor: color,
            borderWidth: thickness,
            borderOpacity: opacity,
            borderLineCap: LineCapStyle.Round,
            blendMode: BlendMode.Multiply,
          });
          break;
        }

        case 'highlight-line': {
          const pts = action.points;
          if (!pts || pts.length < 2) break;
          const [a0, a1] = [pts[0], pts[pts.length - 1]];
          const thickness = Math.max(0.1, (action.style.lineWidth || 0) * pw);
          page.drawLine({
            start: { x: nxToPdfX(a0.x), y: nyToPdfY(a0.y) },
            end: { x: nxToPdfX(a1.x), y: nyToPdfY(a1.y) },
            thickness,
            color,
            opacity,
            lineCap: LineCapStyle.Round,
            blendMode: BlendMode.Multiply,
          });
          break;
        }

        case 'rectangle': {
          const r = action.rect;
          if (!r) break;
          const nx = Math.min(r.x, r.x + r.width);
          const ny = Math.min(r.y, r.y + r.height);
          const nw = Math.abs(r.width);
          const nh = Math.abs(r.height);
          const borderWidth = Math.max(
            0.1,
            (action.style.lineWidth || 0) * pw,
          );
          page.drawRectangle({
            x: nxToPdfX(nx),
            y: ph * (1 - ny - nh),
            width: nw * pw,
            height: nh * ph,
            borderColor: color,
            borderWidth,
            borderOpacity: opacity,
          });
          break;
        }

        case 'text': {
          const t = action.text;
          if (!t || !t.content) break;
          const normFont = action.style.fontSize || 0;
          const fontSize = Math.max(1, normFont * ph);

          if (hasNonAsciiText(t.content)) {
            // 한글/유니코드 → 이미지로 대체
            const rendered = renderTextToPng(
              t.content,
              fontSize,
              action.style.color,
            );
            const png = await pdfDoc.embedPng(rendered.dataUrl);
            page.drawImage(png, {
              x: nxToPdfX(t.x),
              y: ph * (1 - t.y) - rendered.heightPt,
              width: rendered.widthPt,
              height: rendered.heightPt,
            });
          } else {
            const font = await getHelvetica();
            // canvas textBaseline='top'에서 그린 기준으로 pdf 베이스라인 보정
            page.drawText(t.content, {
              x: nxToPdfX(t.x),
              y: ph * (1 - t.y) - fontSize * 0.85,
              size: fontSize,
              font,
              color,
            });
          }
          break;
        }

        case 'mosaic': {
          const m = action.mosaicArea;
          if (!m || !m.imageData) break;
          try {
            const png = await pdfDoc.embedPng(m.imageData);
            page.drawImage(png, {
              x: nxToPdfX(m.x),
              y: ph * (1 - m.y - m.height),
              width: m.width * pw,
              height: m.height * ph,
            });
          } catch (err) {
            console.error('모자이크 이미지 embed 실패', err);
          }
          break;
        }

        case 'none':
        default:
          break;
      }
    }
  }

  return await pdfDoc.save();
}
