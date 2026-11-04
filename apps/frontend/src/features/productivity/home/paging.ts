import { useState } from 'react';

/**
 * Numbered pages inside a Home section so the dashboard fits the screen
 * instead of scrolling. A shrinking list never leaves the user on an empty page.
 */
export function usePagedList<T>(items: T[], size: number) {
  const [requested, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(requested, pageCount);
  return {
    page,
    pageCount,
    setPage,
    visible: items.slice((page - 1) * size, page * size),
  };
}
