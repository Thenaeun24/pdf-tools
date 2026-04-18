'use client';

import { useState } from 'react';
import TabNav, { type TabItem } from '@/components/TabNav';
import Footer from '@/components/Footer';
import Toast from '@/components/Toast';
import PdfImageConverter from '@/components/PdfImageConverter';
import PdfMerge from '@/components/PdfMerge';
import PdfSplit from '@/components/PdfSplit';
import PdfRotate from '@/components/PdfRotate';
import PdfMarkup from '@/components/PdfMarkup';
import { useToast } from '@/hooks/useToast';

type TabId = 'convert' | 'merge' | 'split' | 'rotate' | 'markup';

const TABS: TabItem[] = [
  { id: 'convert', label: 'PDF ↔ 이미지', icon: '🔄' },
  { id: 'merge', label: 'PDF 병합', icon: '🧩' },
  { id: 'split', label: 'PDF 분할', icon: '✂️' },
  { id: 'rotate', label: 'PDF 회전', icon: '↻' },
  { id: 'markup', label: 'PDF 마크업', icon: '✏️' },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabId>('convert');
  const { toasts, addToast, removeToast } = useToast();

  return (
    <>
      <header className="relative overflow-hidden">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-12 sm:py-16">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-600 shadow-sm shadow-indigo-900/5 backdrop-blur">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-[0_0_8px_rgba(139,92,246,0.7)]" />
            Browser · Zero Upload
          </div>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            <span className="gradient-text animate-gradient">PDF 편집 도구</span>
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            변환 · 병합 · 분할 · 회전 · 마크업까지. 업로드 없이{' '}
            <span className="font-semibold text-slate-900">
              브라우저 안에서 완결되는
            </span>{' '}
            프리미엄 PDF 작업 환경.
          </p>
        </div>
      </header>

      <TabNav
        tabs={TABS}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        {activeTab === 'convert' ? (
          <PdfImageConverter addToast={addToast} />
        ) : null}
        {activeTab === 'merge' ? <PdfMerge addToast={addToast} /> : null}
        {activeTab === 'split' ? <PdfSplit addToast={addToast} /> : null}
        {activeTab === 'rotate' ? <PdfRotate addToast={addToast} /> : null}
        {activeTab === 'markup' ? <PdfMarkup addToast={addToast} /> : null}
      </main>

      <Footer />
      <Toast toasts={toasts} onRemove={removeToast} />
    </>
  );
}
