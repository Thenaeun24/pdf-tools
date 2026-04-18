'use client';

import type { ToastMessage } from '@/types';

interface ToastProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

const TYPE_STYLES: Record<
  ToastMessage['type'],
  { bg: string; icon: string; ring: string }
> = {
  success: {
    bg: 'border border-emerald-200/80 bg-emerald-50 text-emerald-950',
    icon: '✓',
    ring: 'ring-emerald-900/5',
  },
  error: {
    bg: 'border border-rose-200/80 bg-rose-50 text-rose-950',
    icon: '!',
    ring: 'ring-rose-900/5',
  },
  info: {
    bg: 'border border-zinc-200/80 bg-white text-zinc-900',
    icon: 'i',
    ring: 'ring-zinc-900/5',
  },
};

export default function Toast({ toasts, onRemove }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => {
        const style = TYPE_STYLES[t.type];
        return (
          <div
            key={t.id}
            role="status"
            className={`animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3.5 shadow-lg shadow-zinc-900/10 ring-1 ${style.bg} ${style.ring}`}
          >
            <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-zinc-900/10 text-xs font-bold text-zinc-700">
              {style.icon}
            </span>
            <p className="flex-1 break-words text-sm leading-relaxed">
              {t.message}
            </p>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={() => onRemove(t.id)}
              className="text-zinc-400 transition-colors hover:text-zinc-700"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
