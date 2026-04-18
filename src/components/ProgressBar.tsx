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
      <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
        <span>{label ?? '진행 중'}</span>
        <span className="font-semibold tabular-nums text-zinc-800">{clamped}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200"
      >
        <div
          className="h-full rounded-full bg-zinc-800 transition-[width] duration-200 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
