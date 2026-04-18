'use client';

import { useState } from 'react';
import PdfToImage from './PdfToImage';
import ImageToPdf from './ImageToPdf';
import type { AddToast } from '@/hooks/useToast';

type SubTab = 'pdf-to-image' | 'image-to-pdf';

interface PdfImageConverterProps {
  addToast: AddToast;
}

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'pdf-to-image', label: 'PDF → 이미지' },
  { id: 'image-to-pdf', label: '이미지 → PDF' },
];

export default function PdfImageConverter({
  addToast,
}: PdfImageConverterProps) {
  const [sub, setSub] = useState<SubTab>('pdf-to-image');

  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex w-full max-w-md rounded-full border border-zinc-200/90 bg-zinc-100/80 p-1 sm:w-auto">
        {SUBTABS.map((t) => {
          const active = t.id === sub;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSub(t.id)}
              className={[
                'flex-1 rounded-full px-5 py-2.5 text-sm font-medium transition-all sm:flex-none',
                active
                  ? 'bg-zinc-900 text-white shadow-sm shadow-zinc-900/20'
                  : 'text-zinc-500 hover:text-zinc-900',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {sub === 'pdf-to-image' ? (
          <PdfToImage addToast={addToast} />
        ) : (
          <ImageToPdf addToast={addToast} />
        )}
      </div>
    </div>
  );
}
