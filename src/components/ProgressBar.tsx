'use client';

interface ProgressBarProps {
  progress: number; // 0 ~ 100
  visible?: boolean;
  label?: string;
}

export default function ProgressBar({
  progress,
  visible = true,
  label,
}: ProgressBarProps) {
  if (!visible) return null;

  const clamped = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-500">{label ?? '진행 중'}</span>
        <span className="gradient-text font-bold tabular-nums">{clamped}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-2.5 w-full overflow-hidden rounded-full border border-white/80 bg-slate-200/60 shadow-inner shadow-slate-900/5"
      >
        <div
          className="brand-gradient animate-gradient animate-shimmer relative h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
