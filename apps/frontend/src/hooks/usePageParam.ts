import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { parsePage } from '../lib/pagination';

/**
 * The current list page, kept in `?page=` so Back from a board returns to the
 * same page. Page changes replace the history entry instead of adding one.
 */
export function usePageParam(): [number, (page: number) => void] {
  const [params, setParams] = useSearchParams();
  const page = parsePage(params.get('page'));
  const setPage = useCallback(
    (next: number) =>
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (next <= 1) updated.delete('page');
          else updated.set('page', String(next));
          return updated;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [page, setPage];
}
