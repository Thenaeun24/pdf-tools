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
    bg: 'bg-emerald-500 text-white',
    icon: '✓',
    ring: 'ring-emerald-300/50',
  },
  error: {
    bg: 'bg-rose-500 text-white',
    icon: '!',
    ring: 'ring-rose-300/50',
  },
  info: {
    bg: 'bg-indigo-500 text-white',
    icon: 'i',
    ring: 'ring-indigo-300/50',
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
            className={`animate-toast-in pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg ring-1 ${style.bg} ${style.ring}`}
          >
            <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-white/20 text-xs font-bold">
              {style.icon}
            </span>
            <p className="flex-1 break-words text-sm leading-relaxed">
              {t.message}
            </p>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={() => onRemove(t.id)}
              className="text-white/80 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
