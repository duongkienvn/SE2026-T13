import { useCallback, useLayoutEffect, useState } from 'react';

export interface FitGridOptions {
  /** Space between rows and columns, in px. */
  gap?: number;
  /** Narrowest a column may get; omit for a single-column list. */
  minColumnWidth?: number;
  maxColumns?: number;
  /** Extra height inside the container that is not rows (borders, padding). */
  reserve?: number;
  /** Used until the layout can be measured (and in tests, which have no layout). */
  fallbackRows: number;
}

export interface FitGrid {
  /** Callback ref for the container that fills the space the list may use. */
  ref: (element: HTMLElement | null) => void;
  rows: number;
  columns: number;
  /** Items that fit on one page: rows × columns. */
  pageSize: number;
  /** True only after measuring a nonzero container and row height. */
  isMeasured: boolean;
}

/**
 * Counts how many rows of a list fit in its container so pages never scroll.
 * Row height is read from the first `[data-fit-row]` element; elements marked
 * `[data-fit-fixed]` (e.g. a table header) are subtracted from the space.
 */
export function useFitGrid({
  gap = 0,
  minColumnWidth,
  maxColumns = 1,
  reserve = 0,
  fallbackRows,
}: FitGridOptions): FitGrid {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [fit, setFit] = useState({
    rows: fallbackRows,
    columns: maxColumns,
    isMeasured: false,
  });

  const measure = useCallback(() => {
    if (!element || element.clientWidth === 0 || element.clientHeight === 0) {
      setFit((current) =>
        current.isMeasured ? { ...current, isMeasured: false } : current,
      );
      return;
    }
    const columns = minColumnWidth
      ? Math.min(
          maxColumns,
          Math.max(
            1,
            Math.floor((element.clientWidth + gap) / (minColumnWidth + gap)),
          ),
        )
      : 1;
    const row = element.querySelector<HTMLElement>('[data-fit-row]');
    const rowHeight = row?.getBoundingClientRect().height ?? 0;
    if (rowHeight === 0) {
      setFit((current) =>
        current.columns === columns && !current.isMeasured
          ? current
          : { ...current, columns, isMeasured: false },
      );
      return;
    }
    let fixed = reserve;
    element
      .querySelectorAll<HTMLElement>('[data-fit-fixed]')
      .forEach((node) => {
        fixed += node.getBoundingClientRect().height;
      });
    const rows = Math.max(
      1,
      Math.floor((element.clientHeight - fixed + gap) / (rowHeight + gap)),
    );
    setFit((current) =>
      current.rows === rows && current.columns === columns && current.isMeasured
        ? current
        : { rows, columns, isMeasured: true },
    );
  }, [element, gap, minColumnWidth, maxColumns, reserve]);

  // Content can change without the container resizing (data arriving, a
  // breakpoint changing row height), so re-measure after every render too.
  // `measure` only updates state when the result changes.
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, measure]);

  return {
    ref: setElement,
    rows: fit.rows,
    columns: fit.columns,
    pageSize: fit.rows * fit.columns,
    isMeasured: fit.isMeasured,
  };
}
