import { cardInsertionPosition } from '../src/api/cards/cards-ordering';

describe('Card ordering reuses E1 exact arithmetic', () => {
  it('inserts at the beginning, middle, end and in an empty column', () => {
    expect(cardInsertionPosition()).toBe('100.0000000000');
    expect(cardInsertionPosition(undefined, '100.0000000000')).toBe(
      '50.0000000000',
    );
    expect(cardInsertionPosition('100.0000000000', '200.0000000000')).toBe(
      '150.0000000000',
    );
    expect(cardInsertionPosition('200.0000000000')).toBe('300.0000000000');
  });
  it('preserves precision beyond JS numbers and requests rebalance for exhausted gaps', () => {
    expect(
      cardInsertionPosition('9999999999.0000000000', '9999999999.0000000004'),
    ).toBe('9999999999.0000000002');
    expect(
      cardInsertionPosition('100.0000000000', '100.0000000001'),
    ).toBeNull();
    expect(cardInsertionPosition(undefined, '0.0000000001')).toBeNull();
    expect(cardInsertionPosition('9999999999.9999999999')).toBeNull();
  });
});
