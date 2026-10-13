import { describe, expect, it } from 'vitest';
import { boardTileIndex } from './BoardIcon';

describe('boardTileIndex', () => {
  it('is stable for the same board id', () => {
    const id = '00000000-0000-4000-9000-000000000042';
    expect(boardTileIndex(id)).toBe(boardTileIndex(id));
  });

  it('spreads different boards across all five design styles', () => {
    const indexes = new Set(
      Array.from({ length: 50 }, (_, n) =>
        boardTileIndex(
          `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
        ),
      ),
    );
    expect([...indexes].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
