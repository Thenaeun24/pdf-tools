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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white px-4 py-3 shadow-sm shadow-zinc-900/5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-800">
              {file.name}
            </p>
            <p className="text-xs text-zinc-500">{fileSizeLabel}</p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
          >
            다른 파일 선택
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sm shadow-zinc-900/5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800">형식</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ImageFormat)}
            disabled={converting}
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-800 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 disabled:opacity-60"
          >
            <option value="png">PNG (무손실)</option>
            <option value="jpeg">JPG (고압축)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800">해상도</span>
          <select
            value={scale}
            onChange={(e) =>
              setScale(Number(e.target.value) as ImageScale)
            }
            disabled={converting}
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-800 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 disabled:opacity-60"
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
          className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {converting ? '변환 중...' : '변환하기'}
        </button>

        {results.length > 0 ? (
          <button
            type="button"
            onClick={downloadZip}
            className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100"
          >
            전체 ZIP 다운로드
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
          <h3 className="mb-3 text-sm font-semibold text-zinc-800">
            미리보기 ({results.length}페이지)
          </h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {results.map((img) => (
              <li
                key={img.pageNumber}
                className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm"
              >
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-zinc-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt={`페이지 ${img.pageNumber}`}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-medium text-zinc-600">
                    페이지 {img.pageNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadOne(img)}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-100"
                  >
                    다운로드
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
