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
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all',
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
          : isDragReject
            ? 'border-rose-400 bg-rose-50 text-rose-700'
            : isDragActive
              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
              : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-400 hover:bg-indigo-50/40',
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
        className="h-10 w-10 opacity-80"
      >
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <p className="text-sm font-medium">
        {isDragActive ? '여기에 놓으세요' : label}
      </p>
      {description ? (
        <p className="text-xs text-slate-500">{description}</p>
      ) : null}
    </div>
  );
}
