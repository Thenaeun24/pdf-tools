'use client';

import { useCallback, useRef, useState } from 'react';
import type { RequestPassword } from '@/utils/pdfDecrypt';

interface PromptState {
  fileName: string;
  retry: boolean;
}

/**
 * 비밀번호로 잠긴 PDF 업로드 시 입력 모달을 띄우는 훅.
 *
 * - `requestPassword` 는 `ensureDecryptedPdfFile` 에 그대로 넘길 수 있는
 *   Promise 기반 콜백이다. 모달의 확인/취소가 Promise 를 resolve 한다.
 * - `passwordModal` 은 컴포넌트 JSX 어딘가에 그대로 렌더링하면 된다.
 */
export function usePasswordPrompt(): {
  requestPassword: RequestPassword;
  passwordModal: React.ReactNode;
} {
  const [state, setState] = useState<PromptState | null>(null);
  const [value, setValue] = useState('');
  const resolverRef = useRef<((password: string | null) => void) | null>(null);

  const requestPassword = useCallback<RequestPassword>((ctx) => {
    setValue('');
    setState(ctx);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((password: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    setValue('');
    resolve?.(password);
  }, []);

  const onSubmit = useCallback(() => {
    if (!value) return;
    settle(value);
  }, [value, settle]);

  const passwordModal = state ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="PDF 비밀번호 입력"
      onKeyDown={(e) => {
        if (e.key === 'Escape') settle(null);
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/10">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900">
              비밀번호로 잠긴 PDF
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {state.fileName}
            </p>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          이 PDF 를 열려면 비밀번호가 필요합니다. 입력하면 잠금을 해제한 뒤
          편집할 수 있습니다.
        </p>

        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="비밀번호"
          className="mt-3 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200"
        />

        {state.retry ? (
          <p className="mt-2 text-xs font-medium text-rose-600">
            비밀번호가 올바르지 않습니다. 다시 시도해 주세요.
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(null)}
            className="rounded-xl px-3 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!value}
            className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            잠금 해제
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { requestPassword, passwordModal };
}
