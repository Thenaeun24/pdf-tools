'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import FileDropZone from './FileDropZone';
import ProgressBar from './ProgressBar';
import {
  assemblePdfFromPages,
  generatePageThumbnailsBatch,
  getPdfPageCount,
  imagesToPdf,
} from '@/utils/pdfUtils';
import { createFileItem, formatFileSize, generateId } from '@/utils/fileUtils';
import { extractRank, sortByName, sortByRank } from '@/utils/rankSort';
import type { AddToast } from '@/hooks/useToast';
import type { FileItem, PageItem, SortOption } from '@/types';

/**
 * Step 1 표시 단위.
 * - 'file': PDF 한 덩어리(여러 페이지를 하나로 다룸)
 * - 'page': 다중 페이지 PDF에서 펼쳐낸 한 페이지(다른 파일 사이에 끼워넣기 가능)
 */
type Step1Entry =
  | { kind: 'file'; id: string; sourceFileId: string }
  | { kind: 'page'; id: string; sourceFileId: string; pageIndex: number };

interface PdfMergeProps {
  addToast: AddToast;
}

const PDF_ACCEPT = { 'application/pdf': ['.pdf'] };
const ADD_PAGE_ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'name-asc', label: '가나다순 (ㄱ→ㅎ)' },
  { id: 'name-desc', label: '가나다 역순 (ㅎ→ㄱ)' },
  { id: 'rank-high', label: '계급순 - 높은 직급 우선 (소방총감→소방사시보)' },
  { id: 'rank-low', label: '계급순 - 낮은 직급 우선 (소방사시보→소방총감)' },
];

const RANK_HELP =
  '파일명에 소방 계급이 포함되어야 합니다.\n예: 소방위_홍길동_보고서.pdf, 소방경_김철수.pdf\n인식 가능: 소방총감, 소방정감, 소방감, 소방준감, 소방정, 소방령, 소방경, 소방위, 소방장, 소방교, 소방사, 소방사시보';

/* -------------------------------------------------------------------------- */
/*                       STEP 1 — 파일 정렬용 내부 컴포넌트                      */
/* -------------------------------------------------------------------------- */

interface FileRowProps {
  entryId: string;
  item: FileItem;
  pageCount: number | null;
  onRemove: (sourceFileId: string) => void;
  onExpand: (sourceFileId: string) => void;
}

function SortableFileRow({
  entryId,
  item,
  pageCount,
  onRemove,
  onExpand,
}: FileRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entryId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const expandable = pageCount != null && pageCount > 1;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5',
        isDragging
          ? 'border-zinc-400 shadow-lg'
          : 'border-zinc-200 hover:border-zinc-300',
      ].join(' ')}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="드래그로 순서 변경"
        className="flex h-8 w-6 flex-none cursor-grab items-center justify-center text-zinc-400 hover:text-zinc-700 active:cursor-grabbing"
      >
        ☰
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-800">
          {item.name}
        </p>
        <p className="text-xs text-zinc-500">
          {formatFileSize(item.size)}
          {' · '}
          {pageCount == null ? (
            <span className="text-zinc-400">페이지 계산 중...</span>
          ) : (
            <span>{pageCount}페이지</span>
          )}
        </p>
      </div>
      {expandable ? (
        <button
          type="button"
          onClick={() => onExpand(item.id)}
          title="페이지 단위로 펼쳐서 사이에 다른 파일을 끼워넣을 수 있습니다"
          className="flex flex-none items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
        >
          펼치기 ▾
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label={`${item.name} 삭제`}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
      >
        ✕
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*               STEP 1 — 펼쳐진 페이지(파일 사이에 끼워넣기) 컴포넌트            */
/* -------------------------------------------------------------------------- */

interface PageRowProps {
  entryId: string;
  sourceFileId: string;
  pageIndex: number;
  pageCount: number | null;
  sourceName: string;
  thumbnail?: string;
  onRemove: (entryId: string) => void;
  onCollapse: (sourceFileId: string) => void;
}

function SortablePageRowStep1({
  entryId,
  sourceFileId,
  pageIndex,
  pageCount,
  sourceName,
  thumbnail,
  onRemove,
  onCollapse,
}: PageRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entryId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'flex items-center gap-3 rounded-lg border bg-zinc-50/60 px-3 py-2',
        'ml-4 border-l-2 border-l-zinc-300',
        isDragging
          ? 'border-zinc-400 shadow-lg'
          : 'border-zinc-200 hover:border-zinc-300',
      ].join(' ')}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="드래그로 순서 변경"
        className="flex h-8 w-6 flex-none cursor-grab items-center justify-center text-zinc-400 hover:text-zinc-700 active:cursor-grabbing"
      >
        ☰
      </button>
      <div className="flex h-12 w-9 flex-none items-center justify-center overflow-hidden rounded border border-zinc-200 bg-white">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-[9px] text-zinc-400">…</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-800">
          {sourceName}
        </p>
        <p className="text-xs text-zinc-500">
          {pageCount != null ? (
            <>
              p.{pageIndex + 1}
              <span className="text-zinc-400"> / {pageCount}</span>
            </>
          ) : (
            <>p.{pageIndex + 1}</>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onCollapse(sourceFileId)}
        title="이 파일의 펼친 페이지를 다시 한 덩어리로 묶기"
        className="flex flex-none items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
      >
        접기 ▴
      </button>
      <button
        type="button"
        onClick={() => onRemove(entryId)}
        aria-label="페이지 삭제"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
      >
        ✕
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*                       STEP 2 — 페이지 썸네일용 내부 컴포넌트                  */
/* -------------------------------------------------------------------------- */

interface PageCardProps {
  page: PageItem;
  orderIndex: number;
  onRotate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}

function SortablePageCard({
  page,
  orderIndex,
  onRotate,
  onDuplicate,
  onRemove,
}: PageCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'flex flex-col overflow-hidden rounded-lg border bg-white',
        isDragging
          ? 'border-zinc-400 shadow-lg'
          : 'border-zinc-200 hover:border-zinc-300',
      ].join(' ')}
    >
      <div
        {...attributes}
        {...listeners}
        className="relative flex aspect-[3/4] cursor-grab items-center justify-center overflow-hidden bg-zinc-100 active:cursor-grabbing"
      >
        {page.thumbnail ? (
          <div className="flex h-full w-full items-center justify-center p-2">
            <div
              className="max-h-full max-w-full transition-transform duration-200"
              style={{ transform: `rotate(${page.rotation}deg)` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.thumbnail}
                alt={`페이지 ${orderIndex + 1}`}
                className="max-h-[240px] max-w-full object-contain"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full animate-pulse items-center justify-center bg-zinc-200 text-xs text-zinc-400">
            불러오는 중...
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {orderIndex + 1}
        </span>
        {page.rotation !== 0 ? (
          <span className="absolute right-1.5 top-1.5 rounded bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {page.rotation}°
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-around gap-1 border-t border-zinc-100 px-2 py-1.5">
        <button
          type="button"
          onClick={() => onRotate(page.id)}
          title="90° 회전"
          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
        >
          🔄
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(page.id)}
          title="복제"
          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
        >
          📋
        </button>
        <button
          type="button"
          onClick={() => onRemove(page.id)}
          title="삭제"
          className="rounded p-1.5 text-zinc-600 hover:bg-rose-50 hover:text-rose-600"
        >
          🗑
        </button>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*                                메인 컴포넌트                                */
/* -------------------------------------------------------------------------- */

export default function PdfMerge({ addToast }: PdfMergeProps) {
  // 공통
  const [step, setStep] = useState<1 | 2>(1);

  // STEP 1 상태
  const [files, setFiles] = useState<FileItem[]>([]);
  const [entries, setEntries] = useState<Step1Entry[]>([]);
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
  const [showSortPreview, setShowSortPreview] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);

  // STEP 2 상태
  const [pages, setPages] = useState<PageItem[]>([]);
  const [sources, setSources] = useState<Map<string, File>>(new Map());
  // sourceFileId:pageIndex → dataUrl. Step 1/2 가 같은 키 공간을 공유한다.
  const [thumbCache, setThumbCache] = useState<Record<string, string>>({});
  const [finalizing, setFinalizing] = useState(false);
  const addPagesInputRef = useRef<HTMLInputElement | null>(null);

  const filesById = useMemo(
    () => new Map(files.map((f) => [f.id, f] as const)),
    [files],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* -------- STEP 1: 페이지 수 비동기 계산 -------- */
  useEffect(() => {
    let cancelled = false;
    const missing = files.filter((f) => pageCounts[f.id] == null);
    if (missing.length === 0) return;

    (async () => {
      for (const f of missing) {
        try {
          const count = await getPdfPageCount(f.file);
          if (cancelled) return;
          setPageCounts((prev) => ({ ...prev, [f.id]: count }));
        } catch {
          if (cancelled) return;
          setPageCounts((prev) => ({ ...prev, [f.id]: -1 }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, pageCounts]);

  // 진행 중이거나 완료된 썸네일 key 추적용 ref. thumbCache 를 effect 의존성에
  // 넣으면 setThumbCache 호출마다 effect 가 재실행되어 같은 소스 PDF 에 대해
  // pdfjs load 가 병렬 중첩되고, 일부 페이지가 빈 canvas 로 떨어지는 레이스가
  // 발생했다. ref 로 in-flight 상태를 기록해 중복 생성을 막는다.
  const thumbInFlight = useRef<Set<string>>(new Set());

  /* -------- STEP 2: 필요한 썸네일 비동기 생성 (sourceId:pageIndex 캐시) -------- */
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;

    // 소스별로 필요한 페이지 인덱스를 묶는다.
    const bySource = new Map<string, number[]>();
    for (const page of pages) {
      const key = `${page.sourceFileId}:${page.pageIndex}`;
      if (thumbInFlight.current.has(key)) continue;
      thumbInFlight.current.add(key);
      const arr = bySource.get(page.sourceFileId);
      if (arr) {
        if (!arr.includes(page.pageIndex)) arr.push(page.pageIndex);
      } else {
        bySource.set(page.sourceFileId, [page.pageIndex]);
      }
    }
    if (bySource.size === 0) return;

    (async () => {
      for (const [sourceId, indices] of bySource) {
        const srcFile = sources.get(sourceId);
        if (!srcFile) continue;
        try {
          await generatePageThumbnailsBatch(srcFile, indices, 0.4, (idx, url) => {
            if (cancelled) return;
            setThumbCache((prev) => ({ ...prev, [`${sourceId}:${idx}`]: url }));
          });
        } catch (err) {
          console.error('썸네일 생성 실패', err);
          // 실패한 key 는 in-flight 에서 풀어 다음 기회에 재시도 가능하도록.
          for (const idx of indices) {
            thumbInFlight.current.delete(`${sourceId}:${idx}`);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, pages, sources]);

  /* -------- STEP 1: 펼친 페이지 row 의 작은 썸네일 -------- */
  useEffect(() => {
    if (step !== 1) return;
    let cancelled = false;

    const bySource = new Map<string, number[]>();
    for (const e of entries) {
      if (e.kind !== 'page') continue;
      const key = `${e.sourceFileId}:${e.pageIndex}`;
      if (thumbInFlight.current.has(key)) continue;
      thumbInFlight.current.add(key);
      const arr = bySource.get(e.sourceFileId);
      if (arr) {
        if (!arr.includes(e.pageIndex)) arr.push(e.pageIndex);
      } else {
        bySource.set(e.sourceFileId, [e.pageIndex]);
      }
    }
    if (bySource.size === 0) return;

    (async () => {
      for (const [sourceId, indices] of bySource) {
        const srcItem = filesById.get(sourceId);
        if (!srcItem) continue;
        try {
          await generatePageThumbnailsBatch(
            srcItem.file,
            indices,
            0.2,
            (idx, url) => {
              if (cancelled) return;
              setThumbCache((prev) => ({
                ...prev,
                [`${sourceId}:${idx}`]: url,
              }));
            },
          );
        } catch (err) {
          console.error('썸네일 생성 실패', err);
          for (const idx of indices) {
            thumbInFlight.current.delete(`${sourceId}:${idx}`);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, entries, filesById]);

  /* -------------- STEP 1 액션들 -------------- */

  const onFilesAdded = useCallback(
    (added: File[]) => {
      const pdfs = added.filter(
        (f) =>
          f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (pdfs.length === 0) {
        addToast('error', 'PDF 파일만 업로드할 수 있습니다.');
        return;
      }
      const items = pdfs.map(createFileItem);
      setFiles((prev) => [...prev, ...items]);
      setEntries((prev) => [
        ...prev,
        ...items.map<Step1Entry>((f) => ({
          kind: 'file',
          id: generateId(),
          sourceFileId: f.id,
        })),
      ]);
    },
    [addToast],
  );

  // 파일 row(✕)에서 호출: 해당 파일을 통째로 제거 (펼친 페이지가 있다면 그것까지)
  const removeFileBySource = useCallback((sourceFileId: string) => {
    setEntries((prev) => prev.filter((e) => e.sourceFileId !== sourceFileId));
    setFiles((prev) => prev.filter((f) => f.id !== sourceFileId));
  }, []);

  // 페이지 row(✕)에서 호출: 그 페이지 entry 만 제거. 더 이상 참조하는 entry 가 없으면
  // 원본 파일도 제거한다.
  const removePageEntry = useCallback((entryId: string) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === entryId);
      const next = prev.filter((e) => e.id !== entryId);
      if (target) {
        const stillUsed = next.some(
          (e) => e.sourceFileId === target.sourceFileId,
        );
        if (!stillUsed) {
          setFiles((fs) => fs.filter((f) => f.id !== target.sourceFileId));
        }
      }
      return next;
    });
  }, []);

  const expandFile = useCallback(
    (sourceFileId: string) => {
      const count = pageCounts[sourceFileId];
      if (!count || count < 1) {
        addToast('info', '페이지 수를 계산하는 중입니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setEntries((prev) => {
        const idx = prev.findIndex(
          (e) => e.kind === 'file' && e.sourceFileId === sourceFileId,
        );
        if (idx === -1) return prev;
        const expanded: Step1Entry[] = Array.from({ length: count }, (_, i) => ({
          kind: 'page',
          id: generateId(),
          sourceFileId,
          pageIndex: i,
        }));
        const next = prev.slice();
        next.splice(idx, 1, ...expanded);
        return next;
      });
    },
    [pageCounts, addToast],
  );

  // 흩어진 페이지들을 다시 한 덩어리(file)로 묶음. 첫 번째 페이지의 위치에 놓는다.
  const collapseFile = useCallback((sourceFileId: string) => {
    setEntries((prev) => {
      const firstIdx = prev.findIndex(
        (e) => e.kind === 'page' && e.sourceFileId === sourceFileId,
      );
      if (firstIdx === -1) return prev;
      const filtered = prev.filter(
        (e) => !(e.kind === 'page' && e.sourceFileId === sourceFileId),
      );
      filtered.splice(firstIdx, 0, {
        kind: 'file',
        id: generateId(),
        sourceFileId,
      });
      return filtered;
    });
  }, []);

  const clearAllFiles = useCallback(() => {
    setFiles([]);
    setEntries([]);
    setShowSortPreview(false);
  }, []);

  const handleEntryDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setEntries((prev) => {
      const oldIndex = prev.findIndex((e) => e.id === active.id);
      const newIndex = prev.findIndex((e) => e.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const sortedPreview = useMemo(() => {
    switch (sortOption) {
      case 'name-asc':
        return sortByName(files, 'asc');
      case 'name-desc':
        return sortByName(files, 'desc');
      case 'rank-high':
        return sortByRank(files, 'high');
      case 'rank-low':
        return sortByRank(files, 'low');
    }
  }, [files, sortOption]);

  const hasExpandedPages = useMemo(
    () => entries.some((e) => e.kind === 'page'),
    [entries],
  );

  const applySort = useCallback(() => {
    if (files.length === 0) return;
    const sorted = sortedPreview;
    setFiles(sorted);
    // 정렬 적용은 항상 파일 단위로 다시 묶는다(펼친 페이지가 있어도).
    setEntries(
      sorted.map<Step1Entry>((f) => ({
        kind: 'file',
        id: generateId(),
        sourceFileId: f.id,
      })),
    );
    setShowSortPreview(false);
    if (hasExpandedPages) {
      addToast(
        'info',
        '정렬을 적용하면서 펼쳐진 페이지를 다시 한 덩어리로 묶었습니다.',
      );
    } else {
      addToast('success', '정렬이 적용되었습니다.');
    }
  }, [files.length, sortedPreview, hasExpandedPages, addToast]);

  const needsRank =
    sortOption === 'rank-high' || sortOption === 'rank-low';

  /* -------------- 병합 실행 → STEP 2 전환 -------------- */

  const handleMerge = useCallback(async () => {
    if (entries.length === 0) {
      addToast('error', '병합할 PDF를 먼저 업로드해 주세요.');
      return;
    }
    if (files.length < 2 && !hasExpandedPages) {
      addToast(
        'info',
        'PDF를 2개 이상 올려야 병합됩니다. 편집만 하시려면 그대로 진행됩니다.',
      );
    }
    setMerging(true);
    setMergeProgress(0);
    try {
      // Step 2 는 원본 파일들을 그대로 참조(sourceFileId + pageIndex)한다.
      // 중간 머지 PDF 를 만들지 않기 때문에 pdf-lib copyPages 가 특정 PDF 에서
      // content stream 을 제대로 복제하지 못해 썸네일이 빈 페이지로 뜨는
      // 문제가 발생하지 않는다. 실제 머지는 "최종 PDF 다운로드" 에서 수행.
      const newSources = new Map<string, File>();
      for (const f of files) newSources.set(f.id, f.file);

      const newPages: PageItem[] = [];
      for (const entry of entries) {
        const srcFile = newSources.get(entry.sourceFileId);
        if (!srcFile) continue;
        if (entry.kind === 'page') {
          newPages.push({
            id: generateId(),
            pageIndex: entry.pageIndex,
            sourceFileId: entry.sourceFileId,
            rotation: 0,
          });
        } else {
          let count = pageCounts[entry.sourceFileId];
          if (count == null || count < 0) {
            count = await getPdfPageCount(srcFile);
          }
          for (let i = 0; i < count; i++) {
            newPages.push({
              id: generateId(),
              pageIndex: i,
              sourceFileId: entry.sourceFileId,
              rotation: 0,
            });
          }
        }
        setMergeProgress((p) =>
          Math.min(95, p + Math.round(95 / entries.length)),
        );
      }

      if (newPages.length === 0) {
        throw new Error('병합할 페이지가 없습니다.');
      }

      setSources(newSources);
      setThumbCache({});
      thumbInFlight.current = new Set();
      setPages(newPages);
      setMergeProgress(100);
      setStep(2);
      addToast('success', `${newPages.length}페이지가 준비되었습니다.`);
    } catch (err) {
      console.error(err);
      addToast(
        'error',
        err instanceof Error ? err.message : '병합 중 오류가 발생했습니다.',
      );
    } finally {
      setMerging(false);
      setTimeout(() => setMergeProgress(0), 600);
    }
  }, [entries, files, pageCounts, hasExpandedPages, addToast]);

  /* -------------- STEP 2 액션들 -------------- */

  const backToStep1 = useCallback(() => {
    setStep(1);
    setPages([]);
    setSources(new Map());
    setThumbCache({});
    thumbInFlight.current = new Set();
  }, []);

  const handlePageDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPages((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === active.id);
      const newIndex = prev.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const rotatePage = useCallback((id: string) => {
    setPages((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    );
  }, []);

  const duplicatePage = useCallback((id: string) => {
    setPages((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const copy: PageItem = { ...prev[idx], id: generateId() };
      const next = prev.slice();
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, []);

  const removePage = useCallback(
    (id: string) => {
      setPages((prev) => {
        if (prev.length <= 1) {
          addToast('error', '마지막 페이지는 삭제할 수 없습니다.');
          return prev;
        }
        return prev.filter((p) => p.id !== id);
      });
    },
    [addToast],
  );

  const triggerAddPages = useCallback(() => {
    addPagesInputRef.current?.click();
  }, []);

  const handleAddPagesChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list || list.length === 0) return;
      const inputEl = e.target;

      try {
        const pdfFiles: File[] = [];
        const imageFiles: File[] = [];
        for (const f of Array.from(list)) {
          const type = f.type.toLowerCase();
          const lower = f.name.toLowerCase();
          if (type === 'application/pdf' || lower.endsWith('.pdf')) {
            pdfFiles.push(f);
          } else if (
            type.startsWith('image/') ||
            /\.(png|jpe?g|webp)$/i.test(lower)
          ) {
            imageFiles.push(f);
          }
        }

        const newSources = new Map(sources);
        const newPages: PageItem[] = [];

        for (const pdfFile of pdfFiles) {
          const srcId = generateId();
          newSources.set(srcId, pdfFile);
          const count = await getPdfPageCount(pdfFile);
          for (let i = 0; i < count; i++) {
            newPages.push({
              id: generateId(),
              pageIndex: i,
              sourceFileId: srcId,
              rotation: 0,
            });
          }
        }

        if (imageFiles.length > 0) {
          // 여러 이미지를 한 번에 1개 PDF로 묶어서 추가
          const blob = await imagesToPdf(imageFiles);
          const ab = await blob.arrayBuffer();
          const synthesized = new File([ab], 'images.pdf', {
            type: 'application/pdf',
          });
          const srcId = generateId();
          newSources.set(srcId, synthesized);
          const count = await getPdfPageCount(synthesized);
          for (let i = 0; i < count; i++) {
            newPages.push({
              id: generateId(),
              pageIndex: i,
              sourceFileId: srcId,
              rotation: 0,
            });
          }
        }

        if (newPages.length === 0) {
          addToast('error', 'PDF 또는 이미지 파일만 추가할 수 있습니다.');
          return;
        }

        setSources(newSources);
        setPages((prev) => [...prev, ...newPages]);
        addToast('success', `${newPages.length}페이지를 추가했습니다.`);
      } catch (err) {
        console.error(err);
        addToast(
          'error',
          err instanceof Error
            ? err.message
            : '페이지 추가 중 오류가 발생했습니다.',
        );
      } finally {
        inputEl.value = '';
      }
    },
    [sources, addToast],
  );

  const handleDownload = useCallback(async () => {
    if (pages.length === 0) return;
    setFinalizing(true);
    try {
      const bytes = await assemblePdfFromPages(
        pages.map((p) => ({
          sourceFileId: p.sourceFileId,
          pageIndex: p.pageIndex,
          rotation: p.rotation,
        })),
        sources,
      );
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      saveAs(new Blob([ab], { type: 'application/pdf' }), 'merged.pdf');
      addToast('success', '최종 PDF를 다운로드합니다.');
    } catch (err) {
      console.error(err);
      addToast(
        'error',
        err instanceof Error ? err.message : 'PDF 생성 중 오류가 발생했습니다.',
      );
    } finally {
      setFinalizing(false);
    }
  }, [pages, sources, addToast]);

  /* ----------------------------------------------------------- */

  // 썸네일을 pages에 투영 (cache 기반)
  const pagesWithThumbs = useMemo(
    () =>
      pages.map((p) => ({
        ...p,
        thumbnail: thumbCache[`${p.sourceFileId}:${p.pageIndex}`],
      })),
    [pages, thumbCache],
  );

  // Step 1 합계 페이지 수: 파일은 pageCount, 페이지 entry 는 1개씩.
  const totalEntryPages = useMemo(() => {
    let total = 0;
    for (const e of entries) {
      if (e.kind === 'page') {
        total += 1;
      } else {
        const c = pageCounts[e.sourceFileId];
        if (typeof c === 'number' && c > 0) total += c;
      }
    }
    return total;
  }, [entries, pageCounts]);

  /* -------------------------------------------------------------------- */
  /*                                렌더링                                */
  /* -------------------------------------------------------------------- */

  if (step === 2) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={backToStep1}
            className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            ◀ 파일 선택으로 돌아가기
          </button>
          <p className="text-sm text-zinc-600">
            총{' '}
            <span className="font-semibold text-zinc-800">{pages.length}</span>
            페이지
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={triggerAddPages}
            className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
          >
            + 페이지 추가 (PDF / 이미지)
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={pages.length === 0 || finalizing}
            className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {finalizing ? '생성 중...' : '최종 PDF 다운로드'}
          </button>
          <input
            ref={addPagesInputRef}
            type="file"
            accept={Object.entries(ADD_PAGE_ACCEPT)
              .flatMap(([mime, exts]) => [mime, ...exts])
              .join(',')}
            multiple
            hidden
            onChange={handleAddPagesChange}
          />
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handlePageDragEnd}
        >
          <SortableContext
            items={pagesWithThumbs.map((p) => p.id)}
            strategy={rectSortingStrategy}
          >
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {pagesWithThumbs.map((page, idx) => (
                <SortablePageCard
                  key={page.id}
                  page={page}
                  orderIndex={idx}
                  onRotate={rotatePage}
                  onDuplicate={duplicatePage}
                  onRemove={removePage}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
    );
  }

  /* ---------- STEP 1 ---------- */

  return (
    <div className="flex flex-col gap-5">
      <FileDropZone
        accept={PDF_ACCEPT}
        multiple
        onFilesAdded={onFilesAdded}
        label={
          files.length === 0
            ? 'PDF 파일들을 드래그하거나 클릭해서 선택하세요'
            : 'PDF 추가 업로드'
        }
        description="여러 PDF를 한 번에 선택할 수 있습니다"
      />

      {files.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-zinc-600">
              <span className="font-semibold text-zinc-800">
                {files.length}
              </span>
              개 PDF
              {totalEntryPages > 0 ? (
                <>
                  {' · 총 '}
                  <span className="font-semibold text-zinc-800">
                    {totalEntryPages}
                  </span>
                  페이지
                </>
              ) : null}
              {' · 드래그로 순서 변경'}
              {hasExpandedPages ? (
                <span className="ml-1 text-xs text-zinc-500">
                  (펼친 페이지를 다른 파일 사이에 끼워넣을 수 있어요)
                </span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={clearAllFiles}
              className="text-sm font-medium text-zinc-500 hover:text-rose-600"
            >
              전체 삭제
            </button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleEntryDragEnd}
          >
            <SortableContext
              items={entries.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {entries.map((entry) => {
                  const item = filesById.get(entry.sourceFileId);
                  if (!item) return null;
                  if (entry.kind === 'file') {
                    return (
                      <SortableFileRow
                        key={entry.id}
                        entryId={entry.id}
                        item={item}
                        pageCount={pageCounts[entry.sourceFileId] ?? null}
                        onRemove={removeFileBySource}
                        onExpand={expandFile}
                      />
                    );
                  }
                  const thumbKey = `${entry.sourceFileId}:${entry.pageIndex}`;
                  return (
                    <SortablePageRowStep1
                      key={entry.id}
                      entryId={entry.id}
                      sourceFileId={entry.sourceFileId}
                      pageIndex={entry.pageIndex}
                      pageCount={pageCounts[entry.sourceFileId] ?? null}
                      sourceName={item.name}
                      thumbnail={thumbCache[thumbKey]}
                      onRemove={removePageEntry}
                      onCollapse={collapseFile}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>

          {/* ----- 정렬 옵션 접이식 패널 ----- */}
          <div className="rounded-2xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-900/5">
            <button
              type="button"
              onClick={() => setSortPanelOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
              aria-expanded={sortPanelOpen}
            >
              <span>정렬 옵션</span>
              <span
                className={`transition-transform ${sortPanelOpen ? 'rotate-180' : ''}`}
              >
                ▾
              </span>
            </button>
            {sortPanelOpen ? (
              <div className="flex flex-col gap-3 border-t border-zinc-100 p-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SORT_OPTIONS.map((opt) => (
                    <label
                      key={opt.id}
                      className={[
                        'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                        sortOption === opt.id
                          ? 'border-zinc-800 bg-zinc-100 text-zinc-900'
                          : 'border-zinc-200 text-zinc-700 hover:border-zinc-300',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="sort-option"
                        className="mt-1"
                        checked={sortOption === opt.id}
                        onChange={() => {
                          setSortOption(opt.id);
                          setShowSortPreview(false);
                        }}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>

                {needsRank ? (
                  <div className="whitespace-pre-line rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                    {RANK_HELP}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applySort}
                    disabled={files.length === 0}
                    className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                  >
                    정렬 적용
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSortPreview((v) => !v)}
                    disabled={files.length === 0}
                    className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {showSortPreview ? '미리보기 닫기' : '미리보기'}
                  </button>
                </div>

                {showSortPreview ? (
                  <ol className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 text-sm">
                    {sortedPreview.map((f, idx) => {
                      const rank = extractRank(f.name);
                      return (
                        <li
                          key={f.id}
                          className="flex items-center gap-2 text-zinc-700"
                        >
                          <span className="w-6 text-right font-mono text-xs text-zinc-500">
                            {idx + 1}.
                          </span>
                          {rank ? (
                            <span className="inline-flex items-center rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-800">
                              {rank}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                              (계급 미인식)
                            </span>
                          )}
                          <span className="truncate">{f.name}</span>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div>
        <button
          type="button"
          onClick={handleMerge}
          disabled={entries.length === 0 || merging}
          className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {merging ? '병합 중...' : '병합하기'}
        </button>
      </div>

      {merging || mergeProgress > 0 ? (
        <ProgressBar
          progress={mergeProgress}
          label={merging ? '병합 중...' : '완료'}
        />
      ) : null}
    </div>
  );
}
