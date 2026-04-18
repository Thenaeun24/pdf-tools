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
  { id: 'convert', label: 'PDF ↔ 이미지' },
  { id: 'merge', label: 'PDF 병합' },
  { id: 'split', label: 'PDF 분할' },
  { id: 'rotate', label: 'PDF 회전' },
  { id: 'markup', label: 'PDF 마크업' },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabId>('convert');
  const { toasts, addToast, removeToast } = useToast();

  return (
    <>
      <header className="bg-gradient-to-r from-indigo-600 via-indigo-600 to-indigo-700 text-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-8 sm:py-10">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            PDF 편집 도구
          </h1>
          <p className="text-sm text-indigo-100 sm:text-base">
            브라우저에서 안전하게 PDF를 편집하세요
          </p>
        </div>
      </header>

      <TabNav
        tabs={TABS}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
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
