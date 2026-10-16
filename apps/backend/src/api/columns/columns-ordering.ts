const FRACTION_DIGITS = 10n;
const SCALE = 10n ** FRACTION_DIGITS;
const POSITION_STEP = 100n * SCALE;

function toUnits(position: string): bigint {
  const match = /^(?<whole>-?\d+)(?:\.(?<fraction>\d+))?$/.exec(position);
  if (!match?.groups?.whole) {
    throw new TypeError('Column position must be a decimal number');
  }
  const fraction = (match.groups.fraction ?? '').padEnd(10, '0');
  if (fraction.length > 10) {
    throw new TypeError('Column position exceeds numeric scale');
  }
  const sign = match.groups.whole.startsWith('-') ? -1n : 1n;
  const absoluteWhole = BigInt(
    sign < 0n ? match.groups.whole.slice(1) : match.groups.whole,
  );
  return sign * (absoluteWhole * SCALE + BigInt(fraction));
}

function fromUnits(units: bigint): string {
  const sign = units < 0n ? '-' : '';
  const absolute = units < 0n ? -units : units;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(10, '0');
  return `${sign}${whole}.${fraction}`;
}

export function appendPosition(lastPosition?: string): string {
  return fromUnits((lastPosition ? toUnits(lastPosition) : 0n) + POSITION_STEP);
}

export function positionBefore(nextPosition: string): string | null {
  return positionBetween('0.0000000000', nextPosition);
}

export function positionBetween(
  previousPosition: string,
  nextPosition: string,
): string | null {
  const previous = toUnits(previousPosition);
  const next = toUnits(nextPosition);
  const gap = next - previous;
  if (gap <= 1n) return null;
  const middle = previous + gap / 2n;
  return middle > previous && middle < next ? fromUnits(middle) : null;
}

export function positionAfter(previousPosition: string): string {
  return appendPosition(previousPosition);
}

export function rebalancePositions(count: number): string[] {
  return Array.from({ length: count }, (_value, index) =>
    fromUnits(POSITION_STEP * BigInt(index + 1)),
  );
}
