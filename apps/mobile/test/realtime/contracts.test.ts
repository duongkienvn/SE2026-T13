import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseHint,
  parseRoomAck,
  socketOrigin,
} from '../../src/infrastructure/realtime/contracts.ts';
import { USER_A, USER_B } from '../auth/support.ts';

test('socket origin uses the validated API origin and fixed root path policy', () => {
  assert.equal(
    socketOrigin('https://example.test/api', false),
    'https://example.test',
  );
  assert.equal(
    socketOrigin('http://10.0.2.2:3000/api', true),
    'http://10.0.2.2:3000',
  );
  assert.equal(socketOrigin('http://example.test/api', true), null);
  assert.equal(socketOrigin(undefined, false), null);
});
test('shared event payloads reject malformed IDs, presence and ACKs', () => {
  assert.equal(
    parseHint('card:updated', { boardId: USER_A, cardId: USER_B }),
    null,
  );
  assert.deepEqual(
    parseHint('card:updated', {
      boardId: USER_A,
      cardId: USER_B,
      columnId: USER_A,
      changeScope: 'checklists',
    }),
    { boardId: USER_A, cardId: USER_B, changeScope: 'checklists' },
  );
  assert.deepEqual(
    parseHint('presence:sync', {
      boardId: USER_A,
      userIds: [USER_B, USER_A, USER_B],
    }),
    { boardId: USER_A, userIds: [USER_A, USER_B] },
  );
  assert.equal(
    parseHint('presence:sync', { boardId: USER_A, userIds: ['bad'] }),
    null,
  );
  assert.deepEqual(parseHint('notifications:changed', {}), {});
  assert.equal(
    parseHint('notifications:changed', { private: 'payload' }),
    null,
  );
  assert.equal(parseRoomAck({ success: true, boardId: USER_B }, USER_A), null);
  assert.deepEqual(
    parseRoomAck(
      { success: false, code: 'NOT_FOUND', message: 'private' },
      USER_A,
    ),
    { success: false, code: 'NOT_FOUND', message: 'Board subscription failed' },
  );
});
