import assert from 'node:assert/strict';
import test from 'node:test';
import { cardBoardScope } from '../../src/api/search/card-board-scope.ts';

const BOARD_A = '11111111-1111-4111-8111-111111111111';
const BOARD_B = '22222222-2222-4222-8222-222222222222';

test('VT053-C01: omitted boardId preserves the legacy unscoped search', () => {
  assert.equal(cardBoardScope(undefined), null);
});

test('VT053-C02: boardId is a bound SQL parameter, never interpolated', () => {
  const result = cardBoardScope(BOARD_A);
  assert.deepEqual(result, {
    clause: 'card.boardId = :boardScopeId',
    params: { boardScopeId: BOARD_A },
  });
  assert.equal(result.clause.includes(BOARD_A), false);
});

test('VT053-C03: different boards retain independent values and fixed SQL', () => {
  const a = cardBoardScope(BOARD_A);
  const b = cardBoardScope(BOARD_B);
  assert.equal(a.clause, b.clause);
  assert.notEqual(a.params.boardScopeId, b.params.boardScopeId);
});
