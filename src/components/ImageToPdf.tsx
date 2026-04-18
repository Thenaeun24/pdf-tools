'use client';
/* eslint-disable react-hooks/set-state-in-effect --
 * Object URL 수명주기 관리를 위해 effect 기반 state 업데이트가 불가피하다.
 * createObjectURL/revokeObjectURL은 render 중에 직접 호출하면 누수가 생긴다.
 */

import { useCallback, useEffect, useState } from 'react';
import { saveAs } from 'file-saver';
import FileDropZone from './FileDropZone';
import ProgressBar from './ProgressBar';
import SortableFileList from './SortableFileList';
import { imagesToPdf } from '@/utils/pdfUtils';
import { createFileItem } from '@/utils/fileUtils';
import type { AddToast } from '@/hooks/useToast';
import type { FileItem } from '@/types';

interface ImageToPdfProps {
  addToast: AddToast;
}

const IMAGE_ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

export default function ImageToPdf({ addToast }: ImageToPdfProps) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  // items에 맞춰 Object URL 맵을 동기화 (제거된 건 revoke, 새로 추가된 건 create).
  useEffect(() => {
    setPreviews((prev) => {
      const next: Record<string, string> = {};
      const activeIds = new Set(items.map((i) => i.id));

      for (const id of Object.keys(prev)) {
        if (activeIds.has(id)) {
          next[id] = prev[id];
        } else {
          URL.revokeObjectURL(prev[id]);
        }
      }
      for (const item of items) {
        if (!next[item.id]) {
          next[item.id] = URL.createObjectURL(item.file);
        }
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    return () => {
      setPreviews((prev) => {
        for (const url of Object.values(prev)) URL.revokeObjectURL(url);
        return {};
      });
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
      setItems((prev) => [...prev, ...images.map(createFileItem)]);
    },
    [addToast],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    setProgress(0);
  }, []);

  const handleConvert = useCallback(async () => {
    if (items.length === 0) return;
    setConverting(true);
    setProgress(10);
    try {
      const blob = await imagesToPdf(items.map((i) => i.file));
      setProgress(100);
      const fileName =
        items.length === 1
          ? `${items[0].name.replace(/\.[^.]+$/, '')}.pdf`
          : `images_${items.length}pages.pdf`;
      saveAs(blob, fileName);
      addToast('success', 'PDF 변환이 완료되었습니다.');
    } catch (err) {
      console.error(err);
      addToast(
        'error',
        err instanceof Error
          ? err.message
          : 'PDF 변환 중 오류가 발생했습니다.',
      );
    } finally {
      setConverting(false);
      setTimeout(() => setProgress(0), 600);
    }
  }, [items, addToast]);

  return (
    <div className="flex flex-col gap-5">
      <FileDropZone
        accept={IMAGE_ACCEPT}
        multiple
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
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-800">
                {items.length}
              </span>
              개 이미지 · 드래그로 순서 변경
            </p>
            <button
              type="button"
              onClick={clearAll}
              className="text-sm font-medium text-slate-500 hover:text-rose-600"
            >
              전체 삭제
            </button>
          </div>

          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {items.map((item, idx) => (
              <li
                key={item.id}
                className="relative overflow-hidden rounded-md border border-slate-200 bg-white"
              >
                <div className="aspect-square bg-slate-100">
                  {previews[item.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previews[item.id]}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {idx + 1}
                </span>
              </li>
            ))}
          </ul>

          <SortableFileList
            items={items}
            onReorder={setItems}
            onRemove={removeItem}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleConvert}
          disabled={items.length === 0 || converting}
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {converting ? '변환 중...' : 'PDF로 변환'}
        </button>
      </div>

      {converting || progress > 0 ? (
        <ProgressBar
          progress={progress}
          label={converting ? 'PDF 생성 중...' : '완료'}
        />
      ) : null}
    </div>
  );
}
