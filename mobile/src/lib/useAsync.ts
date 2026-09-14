import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/**
 * Data loading with explicit loading, error and empty states, which every screen
 * in CampusBuddy is required to have (spec §83, §106).
 */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: T | ((current: T | null) => T)) => void;
}

export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (!active || (cause as Error).name === 'AbortError') return;
        setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const update = useCallback((updater: T | ((current: T | null) => T)) => {
    setData((current) => (typeof updater === 'function' ? (updater as (c: T | null) => T)(current) : updater));
  }, []);

  return { data, loading, error, reload, setData: update };
}
