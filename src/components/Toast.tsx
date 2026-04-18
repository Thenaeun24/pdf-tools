'use client';

import type { ToastMessage } from '@/types';

interface ToastProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

const TYPE_STYLES: Record<
  ToastMessage['type'],
  { bg: string; icon: string; accent: string }
> = {
  success: {
    bg: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/95 via-white/95 to-emerald-50/95 text-emerald-900',
    icon: '✓',
    accent: 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white',
  },
  error: {
    bg: 'border-rose-200/80 bg-gradient-to-br from-rose-50/95 via-white/95 to-rose-50/95 text-rose-900',
    icon: '!',
    accent: 'bg-gradient-to-br from-rose-500 to-pink-500 text-white',
  },
  info: {
    bg: 'border-indigo-200/80 bg-gradient-to-br from-indigo-50/95 via-white/95 to-fuchsia-50/95 text-indigo-900',
    icon: 'i',
    accent: 'bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white',
  },
};

export default function Toast({ toasts, onRemove }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2.5">
      {toasts.map((t) => {
        const style = TYPE_STYLES[t.type];
        return (
          <div
            key={t.id}
            role="status"
            className={`animate-toast-in pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3.5 shadow-2xl shadow-indigo-900/15 backdrop-blur-xl ${style.bg}`}
          >
            <span
              className={`mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold shadow-md shadow-slate-900/10 ${style.accent}`}
            >
              {style.icon}
            </span>
            <p className="flex-1 break-words text-sm font-medium leading-relaxed">
              {t.message}
            </p>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={() => onRemove(t.id)}
              className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
