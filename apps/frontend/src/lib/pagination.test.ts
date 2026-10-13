import { describe, expect, it } from 'vitest';
import { pageNumbers, paginate, parsePage } from './pagination';

const items = Array.from({ length: 10 }, (_, index) => index + 1);

describe('paginate', () => {
  it('returns the items on the requested page', () => {
    expect(paginate(items, 2, 4)).toEqual({
      items: [5, 6, 7, 8],
      page: 2,
      pageCount: 3,
    });
    expect(paginate(items, 3, 4).items).toEqual([9, 10]);
  });

  it('clamps pages outside the range', () => {
    expect(paginate(items, 9, 4).page).toBe(3);
    expect(paginate(items, 0, 4).page).toBe(1);
    expect(paginate(items, Number.NaN, 4).page).toBe(1);
  });

  it('treats an empty list as one empty page', () => {
    expect(paginate([], 1, 4)).toEqual({ items: [], page: 1, pageCount: 1 });
  });

  it('never uses a page size below one', () => {
    expect(paginate(items, 1, 0).items).toEqual([1]);
  });
});

describe('pageNumbers', () => {
  it('lists every page when there are few', () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the first, last and current pages with gaps between', () => {
    expect(pageNumbers(1, 12)).toEqual([1, 2, 3, 4, 5, null, 12]);
    expect(pageNumbers(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(pageNumbers(12, 12)).toEqual([1, null, 8, 9, 10, 11, 12]);
  });

  it('shows only the first, current and last pages without siblings', () => {
    expect(pageNumbers(1, 11, 0)).toEqual([1, 2, 3, null, 11]);
    expect(pageNumbers(6, 11, 0)).toEqual([1, null, 6, null, 11]);
    expect(pageNumbers(11, 11, 0)).toEqual([1, null, 9, 10, 11]);
    expect(pageNumbers(2, 5, 0)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('parsePage', () => {
  it('accepts positive whole numbers only', () => {
    expect(parsePage('3')).toBe(3);
    for (const value of [null, '', '0', '-2', '1.5', 'abc']) {
      expect(parsePage(value)).toBe(1);
    }
  });
});
