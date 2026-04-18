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
      <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
        <span>{label ?? '진행 중'}</span>
        <span className="font-semibold text-indigo-700">{clamped}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-[width] duration-200 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
