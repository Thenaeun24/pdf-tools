'use client';

import { useState } from 'react';
import PdfToImage from './PdfToImage';
import ImageToPdf from './ImageToPdf';
import type { AddToast } from '@/hooks/useToast';

type SubTab = 'pdf-to-image' | 'image-to-pdf';

interface PdfImageConverterProps {
  addToast: AddToast;
}

const SUBTABS: { id: SubTab; label: string; icon: string }[] = [
  { id: 'pdf-to-image', label: 'PDF → 이미지', icon: '🖼' },
  { id: 'image-to-pdf', label: '이미지 → PDF', icon: '📄' },
];

export default function PdfImageConverter({
  addToast,
}: PdfImageConverterProps) {
  const [sub, setSub] = useState<SubTab>('pdf-to-image');

  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex w-full max-w-md rounded-full border border-white/80 bg-white/70 p-1 shadow-sm shadow-indigo-900/5 backdrop-blur sm:w-auto">
        {SUBTABS.map((t) => {
          const active = t.id === sub;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSub(t.id)}
              className={[
                'focus-ring relative flex-1 rounded-full px-5 py-2.5 text-sm font-semibold transition-all sm:flex-none',
                active
                  ? 'text-white shadow-lg shadow-violet-500/30'
                  : 'text-slate-600 hover:text-indigo-700',
              ].join(' ')}
            >
              {active ? (
                <span
                  aria-hidden
                  className="brand-gradient animate-gradient absolute inset-0 rounded-full"
                />
              ) : null}
              <span className="relative inline-flex items-center gap-1.5">
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </span>
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
