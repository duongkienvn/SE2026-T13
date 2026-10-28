import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { WorkspaceBoardFilters, WorkspaceBoardsGateway } from './types';

export function useBoardFilters(features: WorkspaceBoardsGateway['features']) {
  const [params, setParams] = useSearchParams();
  const requestedSort = params.get('sort');
  const requestedPage = Number(params.get('page') ?? 1);
  const filters: WorkspaceBoardFilters = {
    search: features.search ? (params.get('q') ?? '').slice(0, 120).trim() : '',
    status:
      features.status && params.get('status') === 'archived'
        ? 'archived'
        : 'active',
    sort:
      requestedSort === 'name-asc' && features.sorts.includes('name-asc')
        ? 'name-asc'
        : 'updated-desc',
    page:
      features.pagination &&
      Number.isSafeInteger(requestedPage) &&
      requestedPage > 0 &&
      requestedPage <= 1000000
        ? requestedPage
        : 1,
  };
  const [settledSearch, setSettledSearch] = useState(filters.search);
  useEffect(() => {
    const timer = setTimeout(
      () => setSettledSearch(filters.search),
      filters.search ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [filters.search]);
  const update = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    // Search is URL-controlled: commit each input event before the next keystroke.
    // Deferred router transitions otherwise restore an older controlled value.
    void setParams(next, { replace, flushSync: true });
  };
  return {
    filters,
    draft: features.search ? (params.get('q') ?? '').slice(0, 120) : '',
    debouncing: filters.search !== settledSearch,
    search: (value: string) => update({ q: value || null }, true),
    status: (value: WorkspaceBoardFilters['status']) =>
      update({ status: value === 'archived' ? value : null }),
    sort: (value: WorkspaceBoardFilters['sort']) =>
      update({ sort: value === 'name-asc' ? value : null }),
    page: (value: number) => update({ page: value > 1 ? String(value) : null }),
    clear: () => update({ q: null, status: null, sort: null, page: null }),
    filtered:
      !!filters.search ||
      filters.status === 'archived' ||
      filters.sort !== 'updated-desc',
  };
}
