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
    <div className="flex flex-col gap-5">
      <div className="inline-flex w-full max-w-md rounded-full bg-slate-100 p-1 sm:w-auto">
        {SUBTABS.map((t) => {
          const active = t.id === sub;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSub(t.id)}
              className={[
                'flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors sm:flex-none',
                active
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900',
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
