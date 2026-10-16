import {
  appendPosition,
  positionAfter,
  positionBefore,
  positionBetween,
} from '../columns/columns-ordering';

/** Reuse E1 arithmetic; return null when NUMERIC(20,10) needs rebalancing. */
export function cardInsertionPosition(
  previous?: string,
  next?: string,
): string | null {
  const position = previous
    ? next
      ? positionBetween(previous, next)
      : positionAfter(previous)
    : next
      ? positionBefore(next)
      : appendPosition();
  return position && /^\d{1,10}\.\d{10}$/.test(position) ? position : null;
}
