export interface PageSlice<T> {
  items: T[];
  /** 1-based page actually shown, clamped to the available pages. */
  page: number;
  pageCount: number;
}

/** The items on `page` (1-based); out-of-range pages show the nearest page. */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): PageSlice<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(
    pageCount,
    Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1),
  );
  const start = (current - 1) * size;
  return { items: items.slice(start, start + size), page: current, pageCount };
}

/**
 * Page buttons to show, with `null` for a gap: 1 … 4 5 6 … 12. The first,
 * last and current pages are always present, with `siblings` neighbors on
 * each side, so the list never exceeds `2 × siblings + 5` entries.
 */
export function pageNumbers(
  page: number,
  pageCount: number,
  siblings = 1,
): (number | null)[] {
  if (pageCount <= 2 * siblings + 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const start = Math.max(
    2,
    Math.min(page - siblings, pageCount - 2 * siblings - 2),
  );
  const end = Math.min(
    pageCount - 1,
    Math.max(page + siblings, 2 * siblings + 3),
  );
  const middle = Array.from(
    { length: end - start + 1 },
    (_, index) => start + index,
  );
  return [
    1,
    ...(start > 2 ? [null] : []),
    ...middle,
    ...(end < pageCount - 1 ? [null] : []),
    pageCount,
  ];
}

/** Reads a 1-based page number from a `?page=` value; anything else is page 1. */
export function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}
