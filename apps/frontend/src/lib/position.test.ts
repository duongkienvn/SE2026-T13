import { describe, expect, it } from 'vitest';
import { compareByPosition } from './position';

const item = (position: string, id = 'a') => ({ position, id });

describe('compareByPosition', () => {
  it('orders by numeric value, not text', () => {
    expect(
      compareByPosition(item('99.0000000000'), item('100.0000000000')),
    ).toBe(-1);
    expect(
      compareByPosition(item('1000.0000000000'), item('200.0000000000')),
    ).toBe(1);
  });

  it('keeps differences a float would lose', () => {
    // As floats both are 1234567890.0000000002 → equal.
    const low = item('1234567890.0000000001');
    const high = item('1234567890.0000000002');
    expect(Number(low.position)).toBe(Number(high.position));
    expect(compareByPosition(low, high)).toBe(-1);
    expect(compareByPosition(high, low)).toBe(1);
  });

  it('treats different scales of the same value as equal', () => {
    expect(compareByPosition(item('150.5'), item('150.5000000000'))).toBe(0);
    expect(compareByPosition(item('7'), item('7.0000000000'))).toBe(0);
  });

  it('breaks ties by id', () => {
    expect(compareByPosition(item('1.0', 'a'), item('1.0', 'b'))).toBe(-1);
    expect(compareByPosition(item('1.0', 'b'), item('1.0', 'a'))).toBe(1);
  });

  it('handles negative values', () => {
    expect(compareByPosition(item('-1.5'), item('0.0000000000'))).toBe(-1);
  });
});
