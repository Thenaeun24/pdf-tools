'use client';
/* eslint-disable react-hooks/set-state-in-effect --
 * 파일 변경 시 관련 state 초기화 및 비동기 페이지 수 채움을 effect에서 처리.
 */

import { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import FileDropZone from './FileDropZone';
import ProgressBar from './ProgressBar';
import {
  getPdfPageCount,
  splitPdf,
  splitPdfByPage,
} from '@/utils/pdfUtils';
import { formatFileSize } from '@/utils/fileUtils';
import type { AddToast } from '@/hooks/useToast';

interface PdfSplitProps {
  addToast: AddToast;
}

type SplitMode = 'per-page' | 'ranges';

interface ParsedRange {
  start: number;
  end: number;
}

/** "1-3, 4-7, 8-10, 12" 같은 입력을 파싱 */
function parseRanges(
  input: string,
  totalPages: number,
): { ranges: ParsedRange[]; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ranges: [], error: '범위를 입력해 주세요.' };
  }
  const parts = trimmed
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const ranges: ParsedRange[] = [];
  for (const part of parts) {
    const singleMatch = /^\d+$/.exec(part);
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);

    let start: number;
    let end: number;
    if (singleMatch) {
      start = end = Number(part);
    } else if (rangeMatch) {
      start = Number(rangeMatch[1]);
      end = Number(rangeMatch[2]);
    } else {
      return { ranges: [], error: `올바르지 않은 형식입니다: "${part}"` };
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) {
      return { ranges: [], error: `페이지 번호는 1 이상이어야 합니다: "${part}"` };
    }
    if (start > end) {
      return { ranges: [], error: `시작이 끝보다 큽니다: "${part}"` };
    }
    if (end > totalPages) {
      return {
        ranges: [],
        error: `범위가 총 페이지 수(${totalPages})를 초과합니다: "${part}"`,
      };
    }
    ranges.push({ start, end });
  }

  return { ranges, error: null };
}

export default function PdfSplit({ addToast }: PdfSplitProps) {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [mode, setMode] = useState<SplitMode>('per-page');
  const [rangeInput, setRangeInput] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [progress, setProgress] = useState(0);

  // 페이지 수 비동기 계산
  useEffect(() => {
    if (!file) {
      setPageCount(null);
      return;
    }
    let cancelled = false;
    setPageCount(null);
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
      setProgress(0);
    },
    [addToast],
  );

  const reset = useCallback(() => {
    setFile(null);
    setRangeInput('');
    setProgress(0);
  }, []);

  const handleSplit = useCallback(async () => {
    if (!file) return;
    if (!pageCount || pageCount <= 0) {
      addToast('error', 'PDF 페이지 정보를 확인할 수 없습니다.');
      return;
    }

    setSplitting(true);
    setProgress(10);

    try {
      let results: { data: Uint8Array; name: string }[];
      if (mode === 'per-page') {
        results = await splitPdfByPage(file);
      } else {
        const { ranges, error } = parseRanges(rangeInput, pageCount);
        if (error) {
          addToast('error', error);
          return;
        }
        if (ranges.length === 0) {
          addToast('error', '유효한 범위가 없습니다.');
          return;
        }
        results = await splitPdf(file, ranges);
      }

      if (results.length === 0) {
        addToast('error', '분할 결과가 없습니다.');
        return;
      }

      setProgress(70);

      const baseName = file.name.replace(/\.pdf$/i, '') || 'document';
      const zip = new JSZip();
      const folder = zip.folder(baseName) ?? zip;
      for (const r of results) {
        const ab = r.data.buffer.slice(
          r.data.byteOffset,
          r.data.byteOffset + r.data.byteLength,
        ) as ArrayBuffer;
        folder.file(r.name, new Blob([ab], { type: 'application/pdf' }));
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      setProgress(100);
      saveAs(blob, `${baseName}_split.zip`);
      addToast('success', `${results.length}개 파일로 분할했습니다.`);
    } catch (err) {
      console.error(err);
      addToast(
        'error',
        err instanceof Error ? err.message : '분할 중 오류가 발생했습니다.',
      );
    } finally {
      setSplitting(false);
      setTimeout(() => setProgress(0), 600);
    }
  }, [file, pageCount, mode, rangeInput, addToast]);

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

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-700">분할 방식</p>
        <label
          className={[
            'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors',
            mode === 'per-page'
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-slate-200 hover:border-slate-300',
          ].join(' ')}
        >
          <input
            type="radio"
            name="split-mode"
            className="mt-1"
            checked={mode === 'per-page'}
            onChange={() => setMode('per-page')}
          />
          <div>
            <p className="font-medium text-slate-800">페이지별 분할</p>
            <p className="text-xs text-slate-500">
              각 페이지를 개별 PDF로 만듭니다.
            </p>
          </div>
        </label>

        <label
          className={[
            'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors',
            mode === 'ranges'
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-slate-200 hover:border-slate-300',
          ].join(' ')}
        >
          <input
            type="radio"
            name="split-mode"
            className="mt-1"
            checked={mode === 'ranges'}
            onChange={() => setMode('ranges')}
          />
          <div className="flex-1">
            <p className="font-medium text-slate-800">범위 지정 분할</p>
            <p className="text-xs text-slate-500">
              예: <code className="rounded bg-slate-100 px-1">1-3, 4-7, 8-10</code>{' '}
              — 쉼표로 구분된 페이지 또는 범위를 입력하세요.
            </p>
            {mode === 'ranges' ? (
              <input
                type="text"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                placeholder="1-3, 4-7, 8-10"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            ) : null}
          </div>
        </label>
      </div>

      <div>
        <button
          type="button"
          onClick={handleSplit}
          disabled={!file || splitting || pageCount == null}
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {splitting ? '분할 중...' : '분할하기'}
        </button>
      </div>

      {splitting || progress > 0 ? (
        <ProgressBar
          progress={progress}
          label={splitting ? '분할 중...' : '완료'}
        />
      ) : null}
    </div>
  );
}
