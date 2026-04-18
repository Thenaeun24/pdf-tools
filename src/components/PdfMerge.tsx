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
  generatePageThumbnail,
  getPdfPageCount,
  imagesToPdf,
  mergePdfs,
} from '@/utils/pdfUtils';
import { createFileItem, formatFileSize, generateId } from '@/utils/fileUtils';
import { extractRank, sortByName, sortByRank } from '@/utils/rankSort';
import type { AddToast } from '@/hooks/useToast';
import type { FileItem, PageItem, SortOption } from '@/types';

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
  item: FileItem;
  pageCount: number | null;
  onRemove: (id: string) => void;
}

function SortableFileRow({ item, pageCount, onRemove }: FileRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

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
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
  const [showSortPreview, setShowSortPreview] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);

  // STEP 2 상태
  const [pages, setPages] = useState<PageItem[]>([]);
  const [sources, setSources] = useState<Map<string, File>>(new Map());
  const [thumbCache, setThumbCache] = useState<Record<string, string>>({});
  const [finalizing, setFinalizing] = useState(false);
  const addPagesInputRef = useRef<HTMLInputElement | null>(null);

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

  /* -------- STEP 2: 필요한 썸네일 비동기 생성 (sourceId:pageIndex 캐시) -------- */
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;

    const tasks: Array<{ key: string; sourceId: string; pageIndex: number }> = [];
    const seen = new Set<string>();
    for (const page of pages) {
      const key = `${page.sourceFileId}:${page.pageIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (thumbCache[key]) continue;
      tasks.push({ key, sourceId: page.sourceFileId, pageIndex: page.pageIndex });
    }
    if (tasks.length === 0) return;

    (async () => {
      for (const t of tasks) {
        const srcFile = sources.get(t.sourceId);
        if (!srcFile) continue;
        try {
          const dataUrl = await generatePageThumbnail(
            srcFile,
            t.pageIndex,
            0.3,
          );
          if (cancelled) return;
          setThumbCache((prev) => ({ ...prev, [t.key]: dataUrl }));
        } catch (err) {
          console.error('썸네일 생성 실패', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, pages, sources, thumbCache]);

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
      setFiles((prev) => [...prev, ...pdfs.map(createFileItem)]);
    },
    [addToast],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAllFiles = useCallback(() => {
    setFiles([]);
    setShowSortPreview(false);
  }, []);

  const handleFileDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFiles((prev) => {
      const oldIndex = prev.findIndex((i) => i.id === active.id);
      const newIndex = prev.findIndex((i) => i.id === over.id);
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

  const applySort = useCallback(() => {
    if (files.length === 0) return;
    setFiles(sortedPreview);
    setShowSortPreview(false);
    addToast('success', '정렬이 적용되었습니다.');
  }, [files.length, sortedPreview, addToast]);

  const needsRank =
    sortOption === 'rank-high' || sortOption === 'rank-low';

  /* -------------- 병합 실행 → STEP 2 전환 -------------- */

  const handleMerge = useCallback(async () => {
    if (files.length === 0) {
      addToast('error', '병합할 PDF를 먼저 업로드해 주세요.');
      return;
    }
    if (files.length < 2) {
      addToast('info', 'PDF를 2개 이상 올려야 병합됩니다. 편집만 하시려면 그대로 진행됩니다.');
    }
    setMerging(true);
    setMergeProgress(0);
    try {
      const mergedBytes = await mergePdfs(
        files.map((f) => f.file),
        (cur, total) => setMergeProgress(Math.round((cur / total) * 100)),
      );
      // Uint8Array → 안전한 ArrayBuffer 복사
      const ab = mergedBytes.buffer.slice(
        mergedBytes.byteOffset,
        mergedBytes.byteOffset + mergedBytes.byteLength,
      ) as ArrayBuffer;
      const mergedFile = new File([ab], 'merged.pdf', {
        type: 'application/pdf',
      });
      const pageCount = await getPdfPageCount(mergedFile);

      const sourceId = generateId();
      const newPages: PageItem[] = Array.from({ length: pageCount }, (_, i) => ({
        id: generateId(),
        pageIndex: i,
        sourceFileId: sourceId,
        rotation: 0,
      }));

      setSources(new Map([[sourceId, mergedFile]]));
      setThumbCache({});
      setPages(newPages);
      setMergeProgress(100);
      setStep(2);
      addToast('success', `${pageCount}페이지로 병합되었습니다.`);
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
  }, [files, addToast]);

  /* -------------- STEP 2 액션들 -------------- */

  const backToStep1 = useCallback(() => {
    setStep(1);
    setPages([]);
    setSources(new Map());
    setThumbCache({});
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
              개 PDF · 드래그로 순서 변경
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
            onDragEnd={handleFileDragEnd}
          >
            <SortableContext
              items={files.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {files.map((f) => (
                  <SortableFileRow
                    key={f.id}
                    item={f}
                    pageCount={pageCounts[f.id] ?? null}
                    onRemove={removeFile}
                  />
                ))}
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
          disabled={files.length === 0 || merging}
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
