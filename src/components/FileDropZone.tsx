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
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-all',
        disabled
          ? 'cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400'
          : isDragReject
            ? 'border-rose-300 bg-rose-50/80 text-rose-800'
            : isDragActive
              ? 'border-zinc-500 bg-white text-zinc-900 shadow-md shadow-zinc-900/10'
              : 'border-zinc-300 bg-zinc-50/40 text-zinc-600 hover:border-zinc-400 hover:bg-white hover:shadow-sm',
      ].join(' ')}
    >
      <input {...getInputProps()} />
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-10 w-10 text-zinc-400 opacity-90"
      >
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <p className="text-sm font-medium">
        {isDragActive ? '여기에 놓으세요' : label}
      </p>
      {description ? (
        <p className="text-xs text-zinc-500">{description}</p>
      ) : null}
    </div>
  );
}
