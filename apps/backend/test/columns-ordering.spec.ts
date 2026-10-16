import {
  appendPosition,
  positionBefore,
  positionBetween,
  positionAfter,
  rebalancePositions,
} from '../src/api/columns/columns-ordering';

describe('column ordering', () => {
  it('appends using exact decimal arithmetic', () => {
    expect(appendPosition()).toBe('100.0000000000');
    expect(appendPosition('100.0000000000')).toBe('200.0000000000');
  });

  it('calculates a position between adjacent columns without floating point', () => {
    expect(positionBetween('100.0000000000', '200.0000000000')).toBe(
      '150.0000000000',
    );
    expect(positionBetween('100.0000000000', '100.0000000001')).toBeNull();
  });

  it('calculates positions at either edge', () => {
    expect(positionBefore('100.0000000000')).toBe('50.0000000000');
    expect(positionAfter('100.0000000000')).toBe('200.0000000000');
  });

  it('rebases a dense sequence to stable exact positions', () => {
    expect(rebalancePositions(3)).toEqual([
      '100.0000000000',
      '200.0000000000',
      '300.0000000000',
    ]);
  });
});
