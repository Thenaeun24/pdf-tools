'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import type { ToastMessage } from '@/types';
import { generateId } from '@/utils/fileUtils';

const TOAST_DURATION = 3000;

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (type: ToastMessage['type'], message: string) => {
      const id = generateId();
      setToasts((prev) => [...prev, { id, type, message }]);
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, TOAST_DURATION);
      timersRef.current.set(id, timer);
    },
    [],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return { toasts, addToast, removeToast };
}

export type AddToast = ReturnType<typeof useToast>['addToast'];
