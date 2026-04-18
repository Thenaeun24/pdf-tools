'use client';

import { useCallback, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import FileDropZone from './FileDropZone';
import ProgressBar from './ProgressBar';
import { pdfToImages, type PdfPageImage } from '@/utils/pdfUtils';
import { formatFileSize } from '@/utils/fileUtils';
import type { AddToast } from '@/hooks/useToast';
import type { ImageFormat, ImageScale } from '@/types';

interface PdfToImageProps {
  addToast: AddToast;
}

export default function PdfToImage({ addToast }: PdfToImageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState<ImageScale>(2);
  const [progress, setProgress] = useState(0);
  const [converting, setConverting] = useState(false);
  const [results, setResults] = useState<PdfPageImage[]>([]);

  const fileSizeLabel = useMemo(
    () => (file ? formatFileSize(file.size) : ''),
    [file],
  );

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
      setResults([]);
      setProgress(0);
    },
    [addToast],
  );

  const reset = useCallback(() => {
    setFile(null);
    setResults([]);
    setProgress(0);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setConverting(true);
    setProgress(0);
    setResults([]);
    try {
      const images = await pdfToImages(file, format, scale, (cur, total) => {
        setProgress(Math.round((cur / total) * 100));
      });
      setResults(images);
      addToast('success', `${images.length}개 페이지를 변환했습니다.`);
    } catch (err) {
      console.error(err);
      addToast(
        'error',
        err instanceof Error ? err.message : 'PDF 변환 중 오류가 발생했습니다.',
      );
    } finally {
      setConverting(false);
    }
  }, [file, format, scale, addToast]);

  const baseName = useMemo(() => {
    if (!file) return 'document';
    return file.name.replace(/\.pdf$/i, '') || 'document';
  }, [file]);

  const downloadOne = useCallback(
    (img: PdfPageImage) => {
      const ext = format === 'png' ? 'png' : 'jpg';
      const padded = String(img.pageNumber).padStart(
        Math.max(2, String(results.length).length),
        '0',
      );
      saveAs(img.blob, `${baseName}_page${padded}.${ext}`);
    },
    [baseName, format, results.length],
  );

  const downloadZip = useCallback(async () => {
    if (results.length === 0) return;
    try {
      const zip = new JSZip();
      const folder = zip.folder(baseName) ?? zip;
      const ext = format === 'png' ? 'png' : 'jpg';
      const pad = Math.max(2, String(results.length).length);
      results.forEach((img) => {
        const padded = String(img.pageNumber).padStart(pad, '0');
        folder.file(`${baseName}_page${padded}.${ext}`, img.blob);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, `${baseName}_images.zip`);
      addToast('success', 'ZIP 다운로드를 시작합니다.');
    } catch (err) {
      console.error(err);
      addToast('error', 'ZIP 생성 중 오류가 발생했습니다.');
    }
  }, [results, baseName, format, addToast]);

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
        <div className="panel-premium flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0 flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-base shadow-lg shadow-violet-500/30"
            >
              📄
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {file.name}
              </p>
              <p className="text-xs font-medium text-slate-500">{fileSizeLabel}</p>
            </div>
          </div>
          <button type="button" onClick={reset} className="btn-ghost">
            다른 파일 선택
          </button>
        </div>
      )}

      <div className="panel-premium grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            형식
          </span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ImageFormat)}
            disabled={converting}
            className="focus-ring rounded-xl border border-indigo-100 bg-white/90 px-3 py-2.5 font-medium text-slate-800 transition-colors hover:border-indigo-300 disabled:opacity-60"
          >
            <option value="png">PNG (무손실)</option>
            <option value="jpeg">JPG (고압축)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            해상도
          </span>
          <select
            value={scale}
            onChange={(e) =>
              setScale(Number(e.target.value) as ImageScale)
            }
            disabled={converting}
            className="focus-ring rounded-xl border border-indigo-100 bg-white/90 px-3 py-2.5 font-medium text-slate-800 transition-colors hover:border-indigo-300 disabled:opacity-60"
          >
            <option value={1}>1x (표준)</option>
            <option value={2}>2x (선명)</option>
            <option value={3}>3x (최고)</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleConvert}
          disabled={!file || converting}
          className="btn-primary focus-ring"
        >
          {converting ? '✨ 변환 중...' : '✨ 변환하기'}
        </button>

        {results.length > 0 ? (
          <button
            type="button"
            onClick={downloadZip}
            className="btn-secondary focus-ring"
          >
            📦 전체 ZIP 다운로드
          </button>
        ) : null}
      </div>

      {converting || progress > 0 ? (
        <ProgressBar
          progress={progress}
          label={converting ? '변환 중...' : '완료'}
        />
      ) : null}

      {results.length > 0 ? (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <span className="gradient-text text-base">✨ 미리보기</span>
            <span className="rounded-full bg-indigo-100/80 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
              {results.length}페이지
            </span>
          </h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {results.map((img) => (
              <li
                key={img.pageNumber}
                className="panel-premium group flex flex-col overflow-hidden p-0 transition-transform hover:-translate-y-0.5"
              >
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-t-[1.25rem] bg-gradient-to-br from-slate-100 to-indigo-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt={`페이지 ${img.pageNumber}`}
                    className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs font-semibold text-slate-600">
                    페이지 {img.pageNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadOne(img)}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-800"
                  >
                    ⬇ 다운로드
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
