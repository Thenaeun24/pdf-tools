'use client';
/* eslint-disable react-hooks/set-state-in-effect --
 * PDF 파일/페이지 변경과 크기 변경을 effect에서 비동기 렌더링 상태로 반영한다.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { saveAs } from 'file-saver';
import { PDFDocument } from 'pdf-lib';

import FileDropZone from './FileDropZone';
import ProgressBar from './ProgressBar';
import {
  applyMarkupToPdf,
  renderPdfPageToCanvas,
} from '@/utils/pdfUtils';
import type {
  DrawingAction,
  MarkupStyle,
  MarkupTool,
} from '@/types';
import type { AddToast } from '@/hooks/useToast';

interface PdfMarkupProps {
  addToast: AddToast;
}

/* -------------------------------------------------------------------------- */
/*                                 상수/프리셋                                  */
/* -------------------------------------------------------------------------- */

const BACKING_SCALE = 2; // Canvas 내부 해상도 2x
const HIGHLIGHT_OPACITY = 0.35;
const MIN_CSS_WIDTH = 280;
const MAX_CSS_WIDTH = 960;

const TOOLS: Array<{ id: MarkupTool; icon: string; label: string }> = [
  { id: 'highlight-free', icon: '🖊', label: '형광펜 (자유)' },
  { id: 'highlight-line', icon: '📏', label: '형광펜 (직선)' },
  { id: 'rectangle', icon: '⬜', label: '네모박스' },
  { id: 'text', icon: '📝', label: '텍스트' },
  { id: 'mosaic', icon: '🔲', label: '모자이크' },
  { id: 'none', icon: '↗', label: '선택 없음 (기본)' },
];

const HL_COLORS = ['#FFFF00', '#00FF00', '#FF69B4', '#00BFFF'];
const HL_WIDTHS = [2, 4, 8];
const RECT_COLORS = ['#FF0000', '#0000FF', '#008000', '#000000'];
const RECT_WIDTHS = [2, 4, 8];
const TEXT_COLORS = ['#000000', '#FF0000', '#0000FF', '#FFFFFF'];
const TEXT_SIZES = [12, 16, 20, 28];
const MOSAIC_SIZES = [20, 40, 60];
const MOSAIC_INTENSITIES = [10, 15, 20];

/* -------------------------------------------------------------------------- */
/*                                좌표/그리기 헬퍼                              */
/* -------------------------------------------------------------------------- */

function getCanvasCoords(
  e: ReactMouseEvent | ReactTouchEvent | ReactPointerEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  let clientX: number;
  let clientY: number;
  if ('touches' in e) {
    const touch = e.touches[0] ?? e.changedTouches[0];
    clientX = touch.clientX;
    clientY = touch.clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

function strokeFree(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  canvasW: number,
  canvasH: number,
  color: string,
  lineWidthNorm: number,
  opacity: number,
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidthNorm * canvasW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x * canvasW, points[0].y * canvasH);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * canvasW, points[i].y * canvasH);
  }
  ctx.stroke();
  ctx.restore();
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  canvasW: number,
  canvasH: number,
  color: string,
  lineWidthNorm: number,
  opacity: number,
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidthNorm * canvasW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x * canvasW, a.y * canvasH);
  ctx.lineTo(b.x * canvasW, b.y * canvasH);
  ctx.stroke();
  ctx.restore();
}

function strokeRect(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  canvasW: number,
  canvasH: number,
  color: string,
  lineWidthNorm: number,
  opacity: number,
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidthNorm * canvasW;
  ctx.strokeRect(
    rect.x * canvasW,
    rect.y * canvasH,
    rect.width * canvasW,
    rect.height * canvasH,
  );
  ctx.restore();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: { x: number; y: number; content: string },
  canvasW: number,
  canvasH: number,
  color: string,
  fontSizeNorm: number,
) {
  ctx.save();
  const fontSizePx = fontSizeNorm * canvasH;
  ctx.font = `${fontSizePx}px -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(text.content, text.x * canvasW, text.y * canvasH);
  ctx.restore();
}

function drawMosaicImage(
  ctx: CanvasRenderingContext2D,
  area: { x: number; y: number; width: number; height: number; imageData?: string },
  canvasW: number,
  canvasH: number,
  cacheSetter: (url: string, img: HTMLImageElement) => void,
  cacheGetter: (url: string) => HTMLImageElement | undefined,
) {
  const url = area.imageData;
  if (!url) return;
  const cached = cacheGetter(url);
  const drawAt = () => {
    const img = cacheGetter(url);
    if (!img) return;
    ctx.drawImage(
      img,
      area.x * canvasW,
      area.y * canvasH,
      area.width * canvasW,
      area.height * canvasH,
    );
  };
  if (cached && cached.complete) {
    drawAt();
  } else {
    const img = new Image();
    img.onload = () => {
      cacheSetter(url, img);
      drawAt();
    };
    img.src = url;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  컴포넌트                                   */
/* -------------------------------------------------------------------------- */

export default function PdfMarkup({ addToast }: PdfMarkupProps) {
  // 파일/페이지 상태
  const [file, setFile] = useState<File | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  // 도구/스타일
  const [tool, setTool] = useState<MarkupTool>('none');
  const [hlColor, setHlColor] = useState<string>(HL_COLORS[0]);
  const [hlWidth, setHlWidth] = useState<number>(HL_WIDTHS[1]);
  const [rectColor, setRectColor] = useState<string>(RECT_COLORS[0]);
  const [rectWidth, setRectWidth] = useState<number>(RECT_WIDTHS[1]);
  const [textColor, setTextColor] = useState<string>(TEXT_COLORS[0]);
  const [textSize, setTextSize] = useState<number>(TEXT_SIZES[1]);
  const [mosaicSize, setMosaicSize] = useState<number>(MOSAIC_SIZES[1]);
  const [mosaicIntensity, setMosaicIntensity] = useState<number>(
    MOSAIC_INTENSITIES[1],
  );

  // 액션 저장
  const [actionsMap, setActionsMap] = useState<Record<number, DrawingAction[]>>({});
  const [redoMap, setRedoMap] = useState<Record<number, DrawingAction[]>>({});

  // 선 도구용 2단계 상태 (normalized coords)
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null);

  // 텍스트 입력 오버레이 (CSS 좌표는 포인터 시점에 캡처)
  const [textInput, setTextInput] = useState<{
    x: number; // 정규화
    y: number;
    cssX: number;
    cssY: number;
    value: string;
  } | null>(null);

  // 컨테이너 폭 → 리사이즈 대응
  const [containerWidth, setContainerWidth] = useState(0);

  // DOM refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textInputElRef = useRef<HTMLInputElement | null>(null);

  // 드로잉 중간 상태 (refs 로 관리해서 mousemove 처리에서 매번 re-render 방지)
  const isPointerDownRef = useRef(false);
  const freePointsRef = useRef<{ x: number; y: number }[]>([]);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const mosaicBoundsRef = useRef<
    { minX: number; minY: number; maxX: number; maxY: number } | null
  >(null);
  const shiftDownRef = useRef(false);

  // 모자이크 이미지 캐시 (리드로잉 시 재사용)
  const mosaicImgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // 페이지 크기 캐시 (pdf-lib 에서 한 번에 측정)
  const pageSizesRef = useRef<{ w: number; h: number }[]>([]);

  /* ---------------- 파일 드롭 / 초기화 ---------------- */

  const resetAll = useCallback(() => {
    setFile(null);
    setPageNum(1);
    setTotalPages(0);
    setActionsMap({});
    setRedoMap({});
    setLineStart(null);
    setTextInput(null);
    setTool('none');
    pageSizesRef.current = [];
    mosaicImgCacheRef.current.clear();
  }, []);

  const onFilesAdded = useCallback(
    (files: File[]) => {
      const picked = files.find(
        (f) =>
          f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (!picked) {
        addToast('error', 'PDF 파일만 업로드할 수 있습니다.');
        return;
      }
      setActionsMap({});
      setRedoMap({});
      setLineStart(null);
      setTextInput(null);
      setPageNum(1);
      setTotalPages(0);
      setFile(picked);
      mosaicImgCacheRef.current.clear();
    },
    [addToast],
  );

  // 파일 변경 시 페이지 수와 크기 계산
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const bytes = await file.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        if (cancelled) return;
        pageSizesRef.current = doc.getPages().map((p) => {
          const { width, height } = p.getSize();
          return { w: width, h: height };
        });
        setTotalPages(doc.getPageCount());
        setPageNum(1);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          addToast('error', 'PDF를 읽을 수 없습니다.');
          setFile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, addToast]);

  /* ---------------- 컨테이너 리사이즈 감지 ---------------- */

  useEffect(() => {
    if (!file) return;
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const w = Math.max(
        MIN_CSS_WIDTH,
        Math.min(MAX_CSS_WIDTH, el.clientWidth),
      );
      setContainerWidth(w);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [file, totalPages]);

  /* ---------------- 액션 → Canvas 렌더 헬퍼 ---------------- */

  const drawActionOn = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      action: DrawingAction,
      canvasW: number,
      canvasH: number,
    ) => {
      switch (action.tool) {
        case 'highlight-free':
          if (action.points) {
            strokeFree(
              ctx,
              action.points,
              canvasW,
              canvasH,
              action.style.color,
              action.style.lineWidth,
              action.style.opacity,
            );
          }
          break;
        case 'highlight-line':
          if (action.points && action.points.length >= 2) {
            strokeLine(
              ctx,
              action.points[0],
              action.points[action.points.length - 1],
              canvasW,
              canvasH,
              action.style.color,
              action.style.lineWidth,
              action.style.opacity,
            );
          }
          break;
        case 'rectangle':
          if (action.rect) {
            strokeRect(
              ctx,
              action.rect,
              canvasW,
              canvasH,
              action.style.color,
              action.style.lineWidth,
              action.style.opacity,
            );
          }
          break;
        case 'text':
          if (action.text && action.style.fontSize) {
            drawText(
              ctx,
              action.text,
              canvasW,
              canvasH,
              action.style.color,
              action.style.fontSize,
            );
          }
          break;
        case 'mosaic':
          if (action.mosaicArea) {
            drawMosaicImage(
              ctx,
              action.mosaicArea,
              canvasW,
              canvasH,
              (url, img) => mosaicImgCacheRef.current.set(url, img),
              (url) => mosaicImgCacheRef.current.get(url),
            );
          }
          break;
        case 'none':
        default:
          break;
      }
    },
    [],
  );

  /* ---------------- 페이지 렌더링 ---------------- */

  useEffect(() => {
    if (!file || !totalPages || !containerWidth) return;
    if (pageNum < 1 || pageNum > totalPages) return;
    const bg = bgCanvasRef.current;
    const dr = drawCanvasRef.current;
    if (!bg || !dr) return;

    let cancelled = false;
    setRendering(true);
    (async () => {
      try {
        const pageSize = pageSizesRef.current[pageNum - 1];
        if (!pageSize) return;
        const scale = (containerWidth * BACKING_SCALE) / pageSize.w;
        await renderPdfPageToCanvas(file, pageNum, bg, scale);
        if (cancelled) return;
        dr.width = bg.width;
        dr.height = bg.height;
        const ctx = dr.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, dr.width, dr.height);
          const actions = actionsMap[pageNum] ?? [];
          for (const a of actions) {
            drawActionOn(ctx, a, dr.width, dr.height);
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) addToast('error', '페이지를 렌더링할 수 없습니다.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // actionsMap 은 의도적으로 의존성에서 제외: 렌더 후 한 번만 그려 주면 되며,
    // 이후 액션 변경은 별도 effect에서 redrawCurrentPage로 처리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, pageNum, totalPages, containerWidth, drawActionOn, addToast]);

  /* ---------------- 액션 변경 시 현재 페이지 redraw ---------------- */

  const redrawCurrentPage = useCallback(() => {
    const dr = drawCanvasRef.current;
    if (!dr) return;
    const ctx = dr.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dr.width, dr.height);
    const actions = actionsMap[pageNum] ?? [];
    for (const a of actions) {
      drawActionOn(ctx, a, dr.width, dr.height);
    }
  }, [actionsMap, pageNum, drawActionOn]);

  useEffect(() => {
    redrawCurrentPage();
  }, [redrawCurrentPage]);

  /* ---------------- Shift 키 (선 도구 수평 고정) ---------------- */

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftDownRef.current = true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftDownRef.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  /* ---------------- 액션 저장 헬퍼 ---------------- */

  const pushAction = useCallback(
    (action: DrawingAction) => {
      setActionsMap((prev) => {
        const cur = prev[action.page] ?? [];
        return { ...prev, [action.page]: [...cur, action] };
      });
      // 새 액션 추가 시 해당 페이지 redo 비우기
      setRedoMap((prev) => {
        if (!prev[action.page]) return prev;
        const next = { ...prev };
        delete next[action.page];
        return next;
      });
    },
    [],
  );

  /* ---------------- 모자이크 로직 ---------------- */

  // bg + draw 합성에서 브러시 영역을 샘플링 → 블록 평균색 계산 → draw에 그리기
  const applyMosaicAt = useCallback(
    (cx: number, cy: number) => {
      const bg = bgCanvasRef.current;
      const dr = drawCanvasRef.current;
      if (!bg || !dr) return;
      const dctx = dr.getContext('2d');
      if (!dctx) return;

      const backingBrush = mosaicSize * BACKING_SCALE;
      const backingBlock = Math.max(2, mosaicIntensity * BACKING_SCALE);

      const bx = Math.max(0, Math.floor(cx - backingBrush / 2));
      const by = Math.max(0, Math.floor(cy - backingBrush / 2));
      const bw = Math.min(dr.width - bx, Math.ceil(backingBrush));
      const bh = Math.min(dr.height - by, Math.ceil(backingBrush));
      if (bw <= 0 || bh <= 0) return;

      // 합성 canvas에서 해당 영역 픽셀을 읽음
      const tmp = document.createElement('canvas');
      tmp.width = bw;
      tmp.height = bh;
      const tctx = tmp.getContext('2d');
      if (!tctx) return;
      tctx.drawImage(bg, bx, by, bw, bh, 0, 0, bw, bh);
      tctx.drawImage(dr, bx, by, bw, bh, 0, 0, bw, bh);
      const imageData = tctx.getImageData(0, 0, bw, bh);
      const data = imageData.data;

      for (let y = 0; y < bh; y += backingBlock) {
        for (let x = 0; x < bw; x += backingBlock) {
          const blockW = Math.min(backingBlock, bw - x);
          const blockH = Math.min(backingBlock, bh - y);
          let r = 0,
            g = 0,
            b = 0,
            count = 0;
          for (let yy = 0; yy < blockH; yy++) {
            for (let xx = 0; xx < blockW; xx++) {
              const idx = ((y + yy) * bw + (x + xx)) * 4;
              r += data[idx];
              g += data[idx + 1];
              b += data[idx + 2];
              count++;
            }
          }
          if (count === 0) continue;
          const avgR = Math.round(r / count);
          const avgG = Math.round(g / count);
          const avgB = Math.round(b / count);
          dctx.fillStyle = `rgb(${avgR}, ${avgG}, ${avgB})`;
          dctx.fillRect(bx + x, by + y, blockW, blockH);
        }
      }

      const bounds = mosaicBoundsRef.current ?? {
        minX: bx,
        minY: by,
        maxX: bx + bw,
        maxY: by + bh,
      };
      bounds.minX = Math.min(bounds.minX, bx);
      bounds.minY = Math.min(bounds.minY, by);
      bounds.maxX = Math.max(bounds.maxX, bx + bw);
      bounds.maxY = Math.max(bounds.maxY, by + bh);
      mosaicBoundsRef.current = bounds;
    },
    [mosaicSize, mosaicIntensity],
  );

  const finalizeMosaic = useCallback(() => {
    const dr = drawCanvasRef.current;
    const bounds = mosaicBoundsRef.current;
    mosaicBoundsRef.current = null;
    if (!dr || !bounds) return;

    const x0 = Math.max(0, Math.floor(bounds.minX));
    const y0 = Math.max(0, Math.floor(bounds.minY));
    const x1 = Math.min(dr.width, Math.ceil(bounds.maxX));
    const y1 = Math.min(dr.height, Math.ceil(bounds.maxY));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;

    // drawCanvas 의 해당 영역을 PNG 로 캡처 (pdf export / redraw 재사용)
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.drawImage(dr, x0, y0, w, h, 0, 0, w, h);
    const dataUrl = tmp.toDataURL('image/png');

    const action: DrawingAction = {
      tool: 'mosaic',
      style: {
        color: '#000000',
        lineWidth: 0,
        opacity: 1,
        mosaicSize,
        mosaicIntensity,
      },
      mosaicArea: {
        x: x0 / dr.width,
        y: y0 / dr.height,
        width: w / dr.width,
        height: h / dr.height,
        imageData: dataUrl,
      },
      page: pageNum,
    };
    pushAction(action);
  }, [mosaicSize, mosaicIntensity, pageNum, pushAction]);

  /* ---------------- 포인터 이벤트 핸들러 ---------------- */

  const handlePointerDown = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      if (!file || rendering || loading) return;
      if (tool === 'none') return;
      if ('touches' in e) e.preventDefault();

      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const { x, y } = getCanvasCoords(e, canvas);
      const nx = x / canvas.width;
      const ny = y / canvas.height;

      switch (tool) {
        case 'highlight-free': {
          isPointerDownRef.current = true;
          freePointsRef.current = [{ x: nx, y: ny }];
          break;
        }
        case 'highlight-line': {
          // 첫 클릭 → lineStart, 두 번째 클릭 → 확정
          if (!lineStart) {
            setLineStart({ x: nx, y: ny });
          } else {
            const endX = nx;
            const endY = shiftDownRef.current ? lineStart.y : ny;
            const action: DrawingAction = {
              tool: 'highlight-line',
              style: {
                color: hlColor,
                lineWidth: (hlWidth * BACKING_SCALE) / canvas.width,
                opacity: HIGHLIGHT_OPACITY,
              },
              points: [lineStart, { x: endX, y: endY }],
              page: pageNum,
            };
            pushAction(action);
            setLineStart(null);
          }
          break;
        }
        case 'rectangle': {
          isPointerDownRef.current = true;
          rectStartRef.current = { x: nx, y: ny };
          break;
        }
        case 'text': {
          // 해당 위치에 input 오버레이 표시 (CSS 좌표도 함께 캡처)
          const rect = canvas.getBoundingClientRect();
          const clientX =
            'touches' in e
              ? (e.touches[0] ?? e.changedTouches[0]).clientX
              : e.clientX;
          const clientY =
            'touches' in e
              ? (e.touches[0] ?? e.changedTouches[0]).clientY
              : e.clientY;
          setTextInput({
            x: nx,
            y: ny,
            cssX: clientX - rect.left,
            cssY: clientY - rect.top,
            value: '',
          });
          break;
        }
        case 'mosaic': {
          isPointerDownRef.current = true;
          mosaicBoundsRef.current = null;
          applyMosaicAt(x, y);
          break;
        }
      }
    },
    [
      file,
      rendering,
      loading,
      tool,
      lineStart,
      hlColor,
      hlWidth,
      pageNum,
      pushAction,
      applyMosaicAt,
    ],
  );

  const handlePointerMove = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      if (!file) return;
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      if ('touches' in e) e.preventDefault();
      const { x, y } = getCanvasCoords(e, canvas);
      const nx = x / canvas.width;
      const ny = y / canvas.height;

      switch (tool) {
        case 'highlight-free': {
          if (!isPointerDownRef.current) return;
          const pts = freePointsRef.current;
          const last = pts[pts.length - 1];
          pts.push({ x: nx, y: ny });
          // 증분 드로잉 (이전 점 → 현재 점)
          const ctx = canvas.getContext('2d');
          if (ctx && last) {
            ctx.save();
            ctx.globalAlpha = HIGHLIGHT_OPACITY;
            ctx.strokeStyle = hlColor;
            ctx.lineWidth = hlWidth * BACKING_SCALE;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(last.x * canvas.width, last.y * canvas.height);
            ctx.lineTo(nx * canvas.width, ny * canvas.height);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }
        case 'highlight-line': {
          if (!lineStart) return;
          const endY = shiftDownRef.current ? lineStart.y : ny;
          // redraw + 미리보기 점선
          redrawCurrentPage();
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.globalAlpha = 0.7;
            ctx.strokeStyle = hlColor;
            ctx.lineWidth = hlWidth * BACKING_SCALE;
            ctx.beginPath();
            ctx.moveTo(lineStart.x * canvas.width, lineStart.y * canvas.height);
            ctx.lineTo(nx * canvas.width, endY * canvas.height);
            ctx.stroke();
            // 시작점 표시 (작은 원)
            ctx.setLineDash([]);
            ctx.fillStyle = hlColor;
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(
              lineStart.x * canvas.width,
              lineStart.y * canvas.height,
              4 * BACKING_SCALE,
              0,
              Math.PI * 2,
            );
            ctx.fill();
            ctx.restore();
          }
          break;
        }
        case 'rectangle': {
          if (!isPointerDownRef.current) return;
          const start = rectStartRef.current;
          if (!start) return;
          const w = nx - start.x;
          const h = ny - start.y;
          redrawCurrentPage();
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = rectColor;
            ctx.lineWidth = rectWidth * BACKING_SCALE;
            ctx.strokeRect(
              start.x * canvas.width,
              start.y * canvas.height,
              w * canvas.width,
              h * canvas.height,
            );
            ctx.restore();
          }
          break;
        }
        case 'mosaic': {
          if (!isPointerDownRef.current) return;
          applyMosaicAt(x, y);
          break;
        }
      }
    },
    [
      file,
      tool,
      lineStart,
      hlColor,
      hlWidth,
      rectColor,
      rectWidth,
      redrawCurrentPage,
      applyMosaicAt,
    ],
  );

  const handlePointerUp = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      if (!file) return;
      if ('touches' in e) e.preventDefault();
      const canvas = drawCanvasRef.current;
      if (!canvas) return;

      switch (tool) {
        case 'highlight-free': {
          if (!isPointerDownRef.current) return;
          isPointerDownRef.current = false;
          const pts = freePointsRef.current;
          freePointsRef.current = [];
          if (pts.length < 2) return;
          const action: DrawingAction = {
            tool: 'highlight-free',
            style: {
              color: hlColor,
              lineWidth: (hlWidth * BACKING_SCALE) / canvas.width,
              opacity: HIGHLIGHT_OPACITY,
            },
            points: pts,
            page: pageNum,
          };
          pushAction(action);
          break;
        }
        case 'rectangle': {
          if (!isPointerDownRef.current) return;
          isPointerDownRef.current = false;
          const start = rectStartRef.current;
          rectStartRef.current = null;
          if (!start) return;
          const { x, y } = getCanvasCoords(e, canvas);
          const nxEnd = x / canvas.width;
          const nyEnd = y / canvas.height;
          const w = nxEnd - start.x;
          const h = nyEnd - start.y;
          if (Math.abs(w) < 0.005 || Math.abs(h) < 0.005) return;
          const action: DrawingAction = {
            tool: 'rectangle',
            style: {
              color: rectColor,
              lineWidth: (rectWidth * BACKING_SCALE) / canvas.width,
              opacity: 1,
            },
            rect: { x: start.x, y: start.y, width: w, height: h },
            page: pageNum,
          };
          pushAction(action);
          break;
        }
        case 'mosaic': {
          if (!isPointerDownRef.current) return;
          isPointerDownRef.current = false;
          finalizeMosaic();
          break;
        }
      }
    },
    [
      file,
      tool,
      hlColor,
      hlWidth,
      rectColor,
      rectWidth,
      pageNum,
      pushAction,
      finalizeMosaic,
    ],
  );

  /* ---------------- 텍스트 입력 확정/취소 ---------------- */

  const commitTextInput = useCallback(() => {
    setTextInput((cur) => {
      if (!cur) return null;
      const content = cur.value.trim();
      if (!content) return null;
      const canvas = drawCanvasRef.current;
      if (!canvas) return null;
      const action: DrawingAction = {
        tool: 'text',
        style: {
          color: textColor,
          lineWidth: 0,
          opacity: 1,
          fontSize: (textSize * BACKING_SCALE) / canvas.height,
        },
        text: { x: cur.x, y: cur.y, content },
        page: pageNum,
      };
      pushAction(action);
      return null;
    });
  }, [textColor, textSize, pageNum, pushAction]);

  const cancelTextInput = useCallback(() => {
    setTextInput(null);
  }, []);

  // 텍스트 입력창 오픈 시 자동 포커스
  useEffect(() => {
    if (textInput) {
      requestAnimationFrame(() => textInputElRef.current?.focus());
    }
  }, [textInput]);

  /* ---------------- Undo / Redo / Clear ---------------- */

  const canUndo = (actionsMap[pageNum]?.length ?? 0) > 0;
  const canRedo = (redoMap[pageNum]?.length ?? 0) > 0;

  const handleUndo = useCallback(() => {
    setActionsMap((prev) => {
      const cur = prev[pageNum] ?? [];
      if (cur.length === 0) return prev;
      const last = cur[cur.length - 1];
      const nextCur = cur.slice(0, -1);
      setRedoMap((r) => {
        const arr = r[pageNum] ?? [];
        return { ...r, [pageNum]: [...arr, last] };
      });
      return { ...prev, [pageNum]: nextCur };
    });
  }, [pageNum]);

  const handleRedo = useCallback(() => {
    setRedoMap((prev) => {
      const cur = prev[pageNum] ?? [];
      if (cur.length === 0) return prev;
      const last = cur[cur.length - 1];
      const nextCur = cur.slice(0, -1);
      setActionsMap((a) => {
        const arr = a[pageNum] ?? [];
        return { ...a, [pageNum]: [...arr, last] };
      });
      return { ...prev, [pageNum]: nextCur };
    });
  }, [pageNum]);

  const clearCurrentPage = useCallback(() => {
    setActionsMap((prev) => {
      if (!prev[pageNum] || prev[pageNum].length === 0) return prev;
      const next = { ...prev };
      delete next[pageNum];
      return next;
    });
    setRedoMap((prev) => {
      if (!prev[pageNum]) return prev;
      const next = { ...prev };
      delete next[pageNum];
      return next;
    });
  }, [pageNum]);

  const clearAllMarkup = useCallback(() => {
    setActionsMap({});
    setRedoMap({});
  }, []);

  /* ---------------- 저장 ---------------- */

  const handleSave = useCallback(async () => {
    if (!file) return;
    const all: DrawingAction[] = Object.values(actionsMap).flat();
    if (all.length === 0) {
      addToast('info', '저장할 마크업이 없습니다.');
      return;
    }
    setSaving(true);
    setSaveProgress(20);
    try {
      const bytes = await applyMarkupToPdf(file, all);
      setSaveProgress(90);
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const base = file.name.replace(/\.pdf$/i, '') || 'document';
      saveAs(
        new Blob([ab], { type: 'application/pdf' }),
        `${base}_marked.pdf`,
      );
      setSaveProgress(100);
      addToast('success', '마크업 PDF를 다운로드합니다.');
    } catch (err) {
      console.error(err);
      addToast(
        'error',
        err instanceof Error ? err.message : 'PDF 저장 중 오류가 발생했습니다.',
      );
    } finally {
      setSaving(false);
      setTimeout(() => setSaveProgress(0), 600);
    }
  }, [file, actionsMap, addToast]);

  /* ---------------- 페이지 이동 시 상태 정리 ---------------- */

  const gotoPage = useCallback(
    (next: number) => {
      if (next < 1 || next > totalPages) return;
      setLineStart(null);
      setTextInput(null);
      isPointerDownRef.current = false;
      freePointsRef.current = [];
      rectStartRef.current = null;
      mosaicBoundsRef.current = null;
      setPageNum(next);
    },
    [totalPages],
  );

  const currentStyle = useMemo<MarkupStyle>(() => {
    switch (tool) {
      case 'highlight-free':
      case 'highlight-line':
        return {
          color: hlColor,
          lineWidth: hlWidth,
          opacity: HIGHLIGHT_OPACITY,
        };
      case 'rectangle':
        return { color: rectColor, lineWidth: rectWidth, opacity: 1 };
      case 'text':
        return {
          color: textColor,
          lineWidth: 0,
          opacity: 1,
          fontSize: textSize,
        };
      case 'mosaic':
        return {
          color: '#000000',
          lineWidth: 0,
          opacity: 1,
          mosaicSize,
          mosaicIntensity,
        };
      case 'none':
      default:
        return { color: '#000000', lineWidth: 0, opacity: 1 };
    }
  }, [tool, hlColor, hlWidth, rectColor, rectWidth, textColor, textSize, mosaicSize, mosaicIntensity]);

  /* -------------------------------------------------------------------- */
  /*                                 렌더                                  */
  /* -------------------------------------------------------------------- */

  // 파일 미업로드 상태
  if (!file) {
    return (
      <FileDropZone
        accept={{ 'application/pdf': ['.pdf'] }}
        multiple={false}
        onFilesAdded={onFilesAdded}
        label="PDF 파일을 드래그하거나 클릭해서 선택하세요"
        description="업로드된 파일은 브라우저에서만 처리됩니다."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:gap-4">
      {/* ---------------- 도구 패널 (사이드바/상단 툴바) ---------------- */}
      <aside className="flex flex-col gap-3 md:w-60 md:flex-none">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-700">
              {file.name}
            </p>
            <p className="text-[11px] text-slate-500">
              {totalPages}페이지
            </p>
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            다른 파일 열기
          </button>
        </div>

        {/* 도구 선택 */}
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            도구
          </p>
          <div className="hide-scrollbar flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {TOOLS.map((t) => {
              const active = t.id === tool;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTool(t.id);
                    setLineStart(null);
                    setTextInput(null);
                  }}
                  title={t.label}
                  className={[
                    'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-700 hover:bg-slate-100',
                  ].join(' ')}
                >
                  <span aria-hidden>{t.icon}</span>
                  <span className="whitespace-nowrap">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 옵션 영역 */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            옵션
          </p>
          {tool === 'highlight-free' || tool === 'highlight-line' ? (
            <div className="flex flex-col gap-3">
              <OptionRow label="색상">
                <ColorSwatches
                  colors={HL_COLORS}
                  value={hlColor}
                  onChange={setHlColor}
                />
              </OptionRow>
              <OptionRow label="두께">
                <SizeButtons
                  values={HL_WIDTHS}
                  labels={['얇게', '보통', '두껍게']}
                  value={hlWidth}
                  onChange={setHlWidth}
                />
              </OptionRow>
            </div>
          ) : null}

          {tool === 'rectangle' ? (
            <div className="flex flex-col gap-3">
              <OptionRow label="색상">
                <ColorSwatches
                  colors={RECT_COLORS}
                  value={rectColor}
                  onChange={setRectColor}
                />
              </OptionRow>
              <OptionRow label="두께">
                <SizeButtons
                  values={RECT_WIDTHS}
                  labels={['얇게', '보통', '두껍게']}
                  value={rectWidth}
                  onChange={setRectWidth}
                />
              </OptionRow>
            </div>
          ) : null}

          {tool === 'text' ? (
            <div className="flex flex-col gap-3">
              <OptionRow label="색상">
                <ColorSwatches
                  colors={TEXT_COLORS}
                  value={textColor}
                  onChange={setTextColor}
                />
              </OptionRow>
              <OptionRow label="크기">
                <SizeButtons
                  values={TEXT_SIZES}
                  labels={TEXT_SIZES.map((s) => `${s}px`)}
                  value={textSize}
                  onChange={setTextSize}
                />
              </OptionRow>
            </div>
          ) : null}

          {tool === 'mosaic' ? (
            <div className="flex flex-col gap-3">
              <OptionRow label="브러시 크기">
                <SizeButtons
                  values={MOSAIC_SIZES}
                  labels={['소', '중', '대']}
                  value={mosaicSize}
                  onChange={setMosaicSize}
                />
              </OptionRow>
              <OptionRow label="강도">
                <SizeButtons
                  values={MOSAIC_INTENSITIES}
                  labels={['약', '중', '강']}
                  value={mosaicIntensity}
                  onChange={setMosaicIntensity}
                />
              </OptionRow>
            </div>
          ) : null}

          {tool === 'none' ? (
            <p className="text-xs text-slate-500">
              도구를 선택하면 옵션이 나타납니다.
            </p>
          ) : null}

          {tool === 'highlight-line' && lineStart ? (
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
              시작점이 찍혔습니다. 끝점을 클릭하세요. (Shift: 수평 고정)
            </p>
          ) : null}

          <span className="sr-only">
            현재 색상: {currentStyle.color}
          </span>
        </div>

        {/* 액션 */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-2">
          <ActionBtn
            onClick={handleUndo}
            disabled={!canUndo}
            label="↩ Undo"
            title="되돌리기"
          />
          <ActionBtn
            onClick={handleRedo}
            disabled={!canRedo}
            label="↪ Redo"
            title="다시 실행"
          />
          <ActionBtn
            onClick={clearCurrentPage}
            label="🗑 이 페이지"
            title="현재 페이지 지우기"
          />
          <ActionBtn
            onClick={clearAllMarkup}
            label="🗑 전체"
            title="모든 마크업 지우기"
          />
        </div>

        {/* 저장 */}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-md bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '저장 중...' : '💾 마크업 PDF 저장'}
        </button>
        {saving || saveProgress > 0 ? (
          <ProgressBar
            progress={saveProgress}
            label={saving ? 'PDF 생성 중...' : '완료'}
          />
        ) : null}
      </aside>

      {/* ---------------- 캔버스 영역 ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div
          ref={containerRef}
          className="relative mx-auto w-full max-w-[960px] select-none rounded-lg bg-slate-200/60 p-2"
        >
          {loading || rendering ? (
            <div className="flex items-center justify-center py-10 text-sm text-slate-500">
              불러오는 중...
            </div>
          ) : null}

          <div className="relative mx-auto">
            <canvas
              ref={bgCanvasRef}
              className="block h-auto w-full rounded-sm bg-white shadow-sm"
              style={{ zIndex: 1 }}
            />
            <canvas
              ref={drawCanvasRef}
              className="absolute inset-0 h-full w-full rounded-sm"
              style={{
                zIndex: 2,
                cursor:
                  tool === 'none'
                    ? 'default'
                    : tool === 'text'
                      ? 'text'
                      : 'crosshair',
                touchAction: tool === 'none' ? 'auto' : 'none',
              }}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
              onTouchCancel={handlePointerUp}
            />

            {/* 텍스트 입력 오버레이 */}
            {textInput ? (
              <input
                ref={textInputElRef}
                type="text"
                value={textInput.value}
                onChange={(e) =>
                  setTextInput((prev) =>
                    prev ? { ...prev, value: e.target.value } : prev,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitTextInput();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelTextInput();
                  }
                }}
                onBlur={commitTextInput}
                placeholder="텍스트 입력 후 Enter"
                style={{
                  position: 'absolute',
                  left: textInput.cssX,
                  top: textInput.cssY,
                  zIndex: 3,
                  color: textColor,
                  fontSize: textSize,
                  lineHeight: 1.2,
                  background: 'rgba(255,255,255,0.95)',
                  border: '1.5px solid #6366f1',
                  borderRadius: 4,
                  padding: '2px 6px',
                  minWidth: 120,
                  fontFamily:
                    "-apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
                }}
              />
            ) : null}
          </div>
        </div>

        {/* 페이지 네비게이션 */}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => gotoPage(pageNum - 1)}
            disabled={pageNum <= 1 || rendering}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ◀ 이전
          </button>
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-indigo-700">{pageNum}</span>
            {' / '}
            <span>{totalPages}</span>
          </p>
          <button
            type="button"
            onClick={() => gotoPage(pageNum + 1)}
            disabled={pageNum >= totalPages || rendering}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            다음 ▶
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          옵션 영역 소형 컴포넌트들                            */
/* -------------------------------------------------------------------------- */

function OptionRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function ColorSwatches({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`색상 ${c}`}
          style={{ background: c }}
          className={[
            'h-7 w-7 rounded-full border transition-all',
            value === c
              ? 'border-indigo-600 ring-2 ring-indigo-300'
              : 'border-slate-300',
          ].join(' ')}
        />
      ))}
    </>
  );
}

function SizeButtons<T extends number>({
  values,
  labels,
  value,
  onChange,
}: {
  values: T[];
  labels: string[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <>
      {values.map((v, i) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={[
              'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400',
            ].join(' ')}
          >
            {labels[i]}
          </button>
        );
      })}
    </>
  );
}

function ActionBtn({
  onClick,
  disabled,
  label,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex flex-1 items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
}
