'use client';
/* eslint-disable react-hooks/set-state-in-effect --
 * 썸네일 캐시를 effect에서 비동기로 채운다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import FileDropZone from './FileDropZone';
import ProgressBar from './ProgressBar';
import {
  generatePageThumbnail,
  getPdfPageCount,
  rotatePdfPages,
} from '@/utils/pdfUtils';
import { formatFileSize } from '@/utils/fileUtils';
import type { AddToast } from '@/hooks/useToast';

interface PdfRotateProps {
  addToast: AddToast;
}

export default function PdfRotate({ addToast }: PdfRotateProps) {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [rotations, setRotations] = useState<Record<number, number>>({}); // 0-based index → 0/90/180/270
  const [thumbs, setThumbs] = useState<Record<number, string>>({}); // 0-based index → dataURL
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  /* -------- 파일 변경 시 초기화 및 페이지 수 계산 -------- */
  useEffect(() => {
    if (!file) {
      setPageCount(null);
      setRotations({});
      setThumbs({});
      return;
    }
    let cancelled = false;
    setPageCount(null);
    setRotations({});
    setThumbs({});
    (async () => {
      try {
        const n = await getPdfPageCount(file);
        if (!cancelled) setPageCount(n);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setPageCount(-1);
          addToast('error', 'PDF를 읽을 수 없습니다.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, addToast]);

  /* -------- 썸네일 비동기 생성 -------- */
  useEffect(() => {
    if (!file || !pageCount || pageCount <= 0) return;
    let cancelled = false;

    (async () => {
      for (let i = 0; i < pageCount; i++) {
        if (cancelled) return;
        if (thumbs[i]) continue;
        try {
          const dataUrl = await generatePageThumbnail(file, i, 0.3);
          if (cancelled) return;
          setThumbs((prev) => ({ ...prev, [i]: dataUrl }));
        } catch (err) {
          console.error('썸네일 생성 실패', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, pageCount, thumbs]);

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
      setFile(picked);
    },
    [addToast],
  );

  const reset = useCallback(() => {
    setFile(null);
  }, []);

  const rotateOne = useCallback((idx: number) => {
    setRotations((prev) => {
      const cur = prev[idx] ?? 0;
      const next = (cur + 90) % 360;
      return { ...prev, [idx]: next };
    });
  }, []);

  const setAllRotation = useCallback(
    (value: number) => {
      if (!pageCount || pageCount <= 0) return;
      const next: Record<number, number> = {};
      for (let i = 0; i < pageCount; i++) next[i] = value;
      setRotations(next);
    },
    [pageCount],
  );

  const resetRotations = useCallback(() => setRotations({}), []);

  const dirty = useMemo(
    () => Object.values(rotations).some((v) => v && v % 360 !== 0),
    [rotations],
  );

  const handleDownload = useCallback(async () => {
    if (!file || !pageCount) return;
    setProcessing(true);
    setProgress(30);
    try {
      const rotMap = new Map<number, number>();
      for (const [key, val] of Object.entries(rotations)) {
        if (val) rotMap.set(Number(key), val);
      }
      const bytes = await rotatePdfPages(file, rotMap);
      setProgress(90);
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const base = file.name.replace(/\.pdf$/i, '') || 'document';
      saveAs(
        new Blob([ab], { type: 'application/pdf' }),
        `${base}_rotated.pdf`,
      );
      setProgress(100);
      addToast('success', '회전 적용 PDF를 다운로드합니다.');
    } catch (err) {
      console.error(err);
      addToast(
        'error',
        err instanceof Error ? err.message : '회전 적용 중 오류가 발생했습니다.',
      );
    } finally {
      setProcessing(false);
      setTimeout(() => setProgress(0), 600);
    }
  }, [file, pageCount, rotations, addToast]);

  return (
    <div className="flex flex-col gap-5">
      {!file ? (
        <FileDropZone
          accept={{ 'application/pdf': ['.pdf'] }}
          multiple={false}
          onFilesAdded={onFilesAdded}
          label="PDF 파일을 드래그하거나 클릭해서 선택하세요"
          description="업로드된 파일은 브라우저에서만 처리됩니다."
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">
              {file.name}
            </p>
            <p className="text-xs text-slate-500">
              {formatFileSize(file.size)}
              {' · '}
              {pageCount == null ? (
                <span className="text-slate-400">페이지 계산 중...</span>
              ) : pageCount < 0 ? (
                <span className="text-rose-600">읽기 실패</span>
              ) : (
                <span>{pageCount}페이지</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-sm font-medium text-slate-500 hover:text-rose-600"
          >
            다른 파일 선택
          </button>
        </div>
      )}

      {file && pageCount != null && pageCount > 0 ? (
        <>
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-700">
              전체 일괄 회전
            </p>
            <div className="flex flex-wrap gap-2">
              {[90, 180, 270].map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() => setAllRotation(deg)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {deg}°
                </button>
              ))}
              <button
                type="button"
                onClick={resetRotations}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              >
                초기화
              </button>
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: pageCount }).map((_, idx) => {
              const rot = rotations[idx] ?? 0;
              const thumb = thumbs[idx];
              return (
                <li
                  key={idx}
                  className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-slate-100">
                    {thumb ? (
                      <div className="flex h-full w-full items-center justify-center p-2">
                        <div
                          className="max-h-full max-w-full transition-transform duration-200"
                          style={{ transform: `rotate(${rot}deg)` }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumb}
                            alt={`페이지 ${idx + 1}`}
                            className="max-h-[240px] max-w-full object-contain"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full w-full animate-pulse items-center justify-center bg-slate-200 text-xs text-slate-400">
                        불러오는 중...
                      </div>
                    )}
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {idx + 1}
                    </span>
                    {rot !== 0 ? (
                      <span className="absolute right-1.5 top-1.5 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {rot}°
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
                    <span className="text-xs font-medium text-slate-600">
                      회전: {rot}°
                    </span>
                    <button
                      type="button"
                      onClick={() => rotateOne(idx)}
                      title="90° 회전"
                      className="rounded-md px-2 py-1 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
                    >
                      ↻ 90°
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div>
            <button
              type="button"
              onClick={handleDownload}
              disabled={processing || !dirty}
              className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {processing
                ? '생성 중...'
                : dirty
                  ? '회전 적용 PDF 다운로드'
                  : '회전할 페이지를 선택하세요'}
            </button>
          </div>

          {processing || progress > 0 ? (
            <ProgressBar
              progress={progress}
              label={processing ? '회전 적용 중...' : '완료'}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
