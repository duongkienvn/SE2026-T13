/**
 * Column and card `position` values are PostgreSQL `numeric(20,10)` sent as
 * decimal strings (for example `"150.0000000000"`). Comparing them as floats
 * can lose precision, so they are compared as scaled integers instead.
 */
const SCALE = 10;

function toScaled(position: string): bigint {
  const [whole = '0', fraction = ''] = position.trim().split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const scaled = BigInt(
    `${digits || '0'}${fraction.slice(0, SCALE).padEnd(SCALE, '0')}`,
  );
  return negative ? -scaled : scaled;
}

/** Orders by `position ASC, id ASC`, the same order the backend uses. */
export function compareByPosition(
  a: { position: string; id: string },
  b: { position: string; id: string },
): number {
  const left = toScaled(a.position);
  const right = toScaled(b.position);
  if (left !== right) return left < right ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
