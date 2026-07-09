'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import FileDropZone from './FileDropZone';
import ProgressBar from './ProgressBar';
import {
  removeBackground,
  isWebGPUAvailable,
  getActiveDevice,
  type LoadProgress,
} from '@/utils/backgroundRemoval';
import { createFileItem } from '@/utils/fileUtils';
import type { AddToast } from '@/hooks/useToast';

interface BackgroundRemoverProps {
  addToast: AddToast;
}

const IMAGE_ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

interface ResultItem {
  id: string;
  name: string;
  originalUrl: string;
  resultUrl?: string;
  resultBlob?: Blob;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

function outputName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}_누끼.png`;
}

export default function BackgroundRemover({
  addToast,
}: BackgroundRemoverProps) {
  const [items, setItems] = useState<ResultItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [loadStatus, setLoadStatus] = useState('');
  const [doneCount, setDoneCount] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const itemsRef = useRef<ResultItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // 원본 File 은 상태에 담지 않고 id → File 맵으로 따로 보관.
  const fileMap = useRef<Map<string, File>>(new Map());

  // 언마운트 시 모든 Object URL 정리.
  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) {
        URL.revokeObjectURL(it.originalUrl);
        if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
      }
    };
  }, []);

  const onFilesAdded = useCallback(
    (files: File[]) => {
      const images = files.filter(
        (f) =>
          f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name),
      );
      if (images.length === 0) {
        addToast('error', '이미지 파일만 업로드할 수 있습니다.');
        return;
      }
      const next: ResultItem[] = images.map((f) => {
        const base = createFileItem(f);
        fileMap.current.set(base.id, f);
        return {
          id: base.id,
          name: base.name,
          originalUrl: URL.createObjectURL(f),
          status: 'pending' as const,
        };
      });
      setItems((prev) => [...prev, ...next]);
    },
    [addToast],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) {
        URL.revokeObjectURL(target.originalUrl);
        if (target.resultUrl) URL.revokeObjectURL(target.resultUrl);
      }
      fileMap.current.delete(id);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    for (const it of itemsRef.current) {
      URL.revokeObjectURL(it.originalUrl);
      if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
    }
    fileMap.current.clear();
    setItems([]);
    setDoneCount(0);
  }, []);

  const handleProcess = useCallback(async () => {
    const pending = itemsRef.current.filter(
      (i) => i.status === 'pending' || i.status === 'error',
    );
    if (pending.length === 0) return;

    setBusy(true);
    setDoneCount(0);
    setBatchTotal(pending.length);
    setLoadStatus('AI 모델 준비 중...');

    const onLoad = (p: LoadProgress) => {
      setLoadPct(p.percent);
      if (p.status === 'progress') setLoadStatus('AI 모델 다운로드 중...');
      else if (p.status === 'ready' || p.percent >= 100)
        setLoadStatus('모델 준비 완료');
    };

    let ok = 0;
    let firstError = '';
    let lastMs = 0;
    for (const target of pending) {
      const file = fileMap.current.get(target.id);
      if (!file) continue;

      setItems((prev) =>
        prev.map((i) =>
          i.id === target.id ? { ...i, status: 'processing' } : i,
        ),
      );

      try {
        const started = performance.now();
        const blob = await removeBackground(file, onLoad);
        lastMs = performance.now() - started;
        setLoadStatus('모델 준비 완료');
        const resultUrl = URL.createObjectURL(blob);
        ok++;
        setItems((prev) =>
          prev.map((i) =>
            i.id === target.id
              ? { ...i, status: 'done', resultBlob: blob, resultUrl }
              : i,
          ),
        );
      } catch (err) {
        console.error('[background-removal] 처리 실패:', err);
        const msg = err instanceof Error ? err.message : String(err);
        if (!firstError) firstError = msg;
        setItems((prev) =>
          prev.map((i) =>
            i.id === target.id
              ? {
                  ...i,
                  status: 'error',
                  error: msg,
                }
              : i,
          ),
        );
      }
      setDoneCount((c) => c + 1);
    }

    setBusy(false);
    if (ok > 0) {
      const dev = getActiveDevice();
      const devLabel =
        dev === 'webgpu' ? 'GPU 가속' : dev === 'wasm' ? 'CPU' : '';
      const timeLabel = lastMs > 0 ? ` · 마지막 ${(lastMs / 1000).toFixed(1)}초` : '';
      addToast(
        'success',
        `${ok}개 배경 제거 완료${devLabel ? ` (${devLabel}${timeLabel})` : ''}`,
      );
    }
    if (ok < pending.length)
      addToast(
        'error',
        `${pending.length - ok}개 실패${firstError ? `: ${firstError.slice(0, 120)}` : ''}`,
      );
  }, [addToast]);

  const downloadOne = useCallback((item: ResultItem) => {
    if (item.resultBlob) saveAs(item.resultBlob, outputName(item.name));
  }, []);

  const downloadAll = useCallback(async () => {
    const done = itemsRef.current.filter(
      (i) => i.status === 'done' && i.resultBlob,
    );
    if (done.length === 0) return;
    if (done.length === 1) {
      saveAs(done[0].resultBlob!, outputName(done[0].name));
      return;
    }
    const zip = new JSZip();
    for (const it of done) zip.file(outputName(it.name), it.resultBlob!);
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `누끼_${done.length}장.zip`);
  }, []);

  const doneItems = items.filter((i) => i.status === 'done');
  const pendingCount = items.filter(
    (i) => i.status === 'pending' || i.status === 'error',
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/60 px-4 py-3 text-xs leading-relaxed text-zinc-600">
        <p className="font-semibold text-zinc-700">
          🔒 이미지는 기기 밖으로 나가지 않습니다.
        </p>
        <p className="mt-1">
          브라우저 안에서 AI 모델(RMBG-1.4)로 배경을 제거합니다. 최초 1회만
          모델 파일(약 44MB)을 이 사이트에서 받아 캐시하며(외부 CDN 미사용),
          이미지 자체는 서버로 전송되지 않습니다.
          {isWebGPUAvailable()
            ? ' 이 브라우저는 WebGPU 가속을 지원해 빠르게 처리됩니다.'
            : ' (WebGPU 미지원 브라우저라 CPU로 처리되어 이미지당 수 초 걸릴 수 있습니다.)'}
        </p>
      </div>

      <FileDropZone
        accept={IMAGE_ACCEPT}
        multiple
        disabled={busy}
        onFilesAdded={onFilesAdded}
        label={
          items.length === 0
            ? '이미지를 드래그하거나 클릭해서 선택하세요'
            : '이미지 추가 업로드'
        }
        description="PNG, JPG, WEBP 지원 · 여러 장 선택 가능"
      />

      {items.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-zinc-600">
              <span className="font-semibold text-zinc-800">
                {items.length}
              </span>
              개 이미지
              {doneItems.length > 0 ? (
                <span className="ml-1 text-emerald-600">
                  · {doneItems.length}개 완료
                </span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={clearAll}
              disabled={busy}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-800 disabled:opacity-40"
            >
              전체 삭제
            </button>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((item) => (
              <li
                key={item.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm"
              >
                <div className="checkerboard relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.resultUrl ?? item.originalUrl}
                    alt={item.name}
                    className="h-full w-full object-contain"
                  />
                  {item.status === 'processing' ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-zinc-700">
                      처리 중...
                    </div>
                  ) : null}
                  {item.status === 'error' ? (
                    <div
                      title={item.error}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-rose-50/90 px-2 text-center text-[11px] font-medium text-rose-700"
                    >
                      <span className="font-semibold">실패</span>
                      {item.error ? (
                        <span className="line-clamp-3 leading-tight opacity-80">
                          {item.error}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {item.status === 'done' ? (
                    <span className="absolute left-1.5 top-1.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      완료
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={busy}
                    aria-label="삭제"
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 disabled:hidden"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.4}
                      strokeLinecap="round"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="truncate text-[11px] text-zinc-500">
                    {item.name}
                  </span>
                  {item.status === 'done' ? (
                    <button
                      type="button"
                      onClick={() => downloadOne(item)}
                      className="shrink-0 text-[11px] font-semibold text-zinc-700 hover:text-zinc-900"
                    >
                      저장
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleProcess}
          disabled={busy || pendingCount === 0}
          className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {busy ? '처리 중...' : `배경 제거${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
        </button>
        {doneItems.length > 0 ? (
          <button
            type="button"
            onClick={downloadAll}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-40"
          >
            {doneItems.length > 1 ? '전체 저장(ZIP)' : '저장'}
          </button>
        ) : null}
      </div>

      {busy ? (
        <div className="flex flex-col gap-2">
          {loadPct > 0 && loadPct < 100 ? (
            <ProgressBar progress={loadPct} label={loadStatus} />
          ) : null}
          {batchTotal > 0 ? (
            <ProgressBar
              progress={(doneCount / batchTotal) * 100}
              label={`이미지 처리 중 (${doneCount}/${batchTotal})`}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
