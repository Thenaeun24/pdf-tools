'use client';

import { useDropzone, type Accept } from 'react-dropzone';

interface FileDropZoneProps {
  accept?: Accept;
  multiple?: boolean;
  onFilesAdded: (files: File[]) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export default function FileDropZone({
  accept,
  multiple = true,
  onFilesAdded,
  label = '파일을 드래그하거나 클릭해서 선택하세요',
  description,
  disabled = false,
}: FileDropZoneProps) {
  const { getRootProps, getInputProps, isDragActive, isDragReject, open } =
    useDropzone({
      accept,
      multiple,
      disabled,
      noClick: true,
      noKeyboard: true,
      onDrop: (acceptedFiles) => {
        if (acceptedFiles.length > 0) onFilesAdded(acceptedFiles);
      },
    });

  return (
    <div
      {...getRootProps()}
      onClick={disabled ? undefined : open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      className={[
        'group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border-2 border-dashed px-8 py-14 text-center transition-all duration-300',
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-50/60 text-slate-400'
          : isDragReject
            ? 'border-rose-400 bg-rose-50/80 text-rose-800 shadow-lg shadow-rose-500/20'
            : isDragActive
              ? 'scale-[1.01] border-violet-500 bg-gradient-to-br from-indigo-50/90 via-white to-fuchsia-50/90 text-indigo-900 shadow-2xl shadow-violet-500/25'
              : 'border-indigo-200/80 bg-white/70 text-slate-600 shadow-sm shadow-indigo-900/5 hover:border-violet-400 hover:bg-white/90 hover:shadow-xl hover:shadow-violet-500/15',
      ].join(' ')}
    >
      {/* 호버/드래그 시 은은한 그라디언트 광택 */}
      {!disabled ? (
        <span
          aria-hidden
          className={[
            'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500',
            isDragActive
              ? 'opacity-100'
              : 'group-hover:opacity-60',
          ].join(' ')}
          style={{
            backgroundImage:
              'radial-gradient(600px 240px at 50% 0%, rgba(139,92,246,0.12), transparent 70%), radial-gradient(500px 280px at 50% 100%, rgba(217,70,239,0.10), transparent 70%)',
          }}
        />
      ) : null}

      <input {...getInputProps()} />

      {/* 아이콘 배지 */}
      <div
        className={[
          'relative flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-300',
          disabled
            ? 'bg-slate-100 text-slate-300'
            : isDragReject
              ? 'bg-rose-100 text-rose-600'
              : 'brand-gradient text-white shadow-lg shadow-violet-500/30 group-hover:scale-105',
          isDragActive && !isDragReject ? 'animate-pulse-ring scale-110' : '',
        ].join(' ')}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7 drop-shadow-sm"
        >
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      </div>

      <p
        className={[
          'relative text-base font-semibold',
          isDragActive && !isDragReject
            ? 'gradient-text'
            : 'text-slate-800',
        ].join(' ')}
      >
        {isDragActive ? '여기에 놓으세요 ✨' : label}
      </p>
      {description ? (
        <p className="relative text-sm text-slate-500">{description}</p>
      ) : null}
    </div>
  );
}
