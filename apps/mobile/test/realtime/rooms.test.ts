import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBoardRooms } from '../../src/infrastructure/realtime/rooms.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { FakeTime, USER_A, USER_B, deferred, flush } from '../auth/support.ts';
import { FakeSocket } from './support.ts';
const access = {
  id: USER_A,
  workspaceId: USER_B,
  isArchived: false,
  capabilities: { canReadBoard: true, canWriteBoard: true },
};
function setup(probe = async (_id: string, _signal: AbortSignal) => access) {
  const time = new FakeTime();
  const socket = new FakeSocket(() => 'test');
  socket.connected = true;
  let probes = 0;
  let recovered = 0;
  let revoked = 0;
  let restarts = 0;
  const rooms = createBoardRooms({
    socket: () => socket,
    timers: time,
    probe: (id, signal) => {
      probes++;
      return probe(id, signal);
    },
    fence(_id, denied) {
      if (denied) revoked++;
    },
    grant() {},
    recovered() {
      recovered++;
    },
    unauthorized() {},
    restart() {
      restarts++;
    },
  });
  return {
    time,
    socket,
    rooms,
    get probes() {
      return probes;
    },
    get recovered() {
      return recovered;
    },
    get revoked() {
      return revoked;
    },
    get restarts() {
      return restarts;
    },
  };
}
test('Board consumers reference count; presence before ACK is buffered, then live only for the current grant', async () => {
  const c = setup();
  const one = c.rooms.watch(USER_A);
  const two = c.rooms.watch(USER_A.toUpperCase());
  await flush();
  assert.equal(c.probes, 1);
  assert.equal(c.socket.commands.length, 1);
  c.rooms.presence(USER_A, [USER_A, USER_B]);
  assert.deepEqual(c.rooms.getSnapshot(USER_A).userIds, []);
  c.socket.ack(0);
  assert.equal(c.rooms.getSnapshot(USER_A).status, 'live');
  assert.equal(c.recovered, 1);
  assert.deepEqual(c.rooms.getSnapshot(USER_A).userIds, [USER_A, USER_B]);
  one();
  assert.equal(c.socket.commands.length, 1);
  two();
  assert.equal(c.socket.commands[1]?.event, 'board:leave');
  c.socket.ack(1);
  c.rooms.dispose();
  assert.equal(c.time.timerCount, 0);
});
test('unmount during a join sends an ordered leave; stale ACK and probe cannot restore the room', async () => {
  const c = setup();
  const stop = c.rooms.watch(USER_A);
  await flush();
  stop();
  c.socket.ack(0);
  c.socket.ack(1);
  assert.equal(c.recovered, 0);
  assert.equal(c.rooms.getSnapshot(USER_A).canRead, false);
  c.rooms.dispose();
  assert.equal(c.time.timerCount, 0);
  const gate = deferred<typeof access>();
  const late = setup(() => gate.promise);
  const unwatch = late.rooms.watch(USER_A);
  unwatch();
  gate.resolve(access);
  await flush();
  assert.equal(late.socket.commands.length, 0);
  late.rooms.dispose();
});
test('authoritative access failure and rejected joins revoke; transient ACK errors retry boundedly', async () => {
  const denied = setup(async () => {
    throw new ApiError('http', { status: 404 });
  });
  denied.rooms.watch(USER_A);
  await flush();
  assert.equal(denied.rooms.getSnapshot(USER_A).status, 'unavailable');
  assert.equal(denied.revoked, 1);
  denied.rooms.dispose();
  const c = setup();
  c.rooms.watch(USER_A);
  await flush();
  c.socket.ack(0, { success: false, code: 'NOT_FOUND' });
  assert.equal(c.rooms.getSnapshot(USER_A).status, 'unavailable');
  c.socket.ack(1);
  c.rooms.dispose();
  assert.equal(c.time.timerCount, 0);
  const retry = setup();
  retry.rooms.watch(USER_A);
  await flush();
  for (const delay of [250, 500, 1000]) {
    retry.socket.ack(retry.socket.commands.length - 1, {
      success: false,
      code: 'TOO_MANY_REQUESTS',
    });
    retry.time.advance(delay);
  }
  retry.socket.ack(retry.socket.commands.length - 1, {
    success: false,
    code: 'INTERNAL_ERROR',
  });
  assert.equal(retry.rooms.getSnapshot(USER_A).status, 'paused');
  retry.rooms.dispose();
  assert.equal(retry.time.timerCount, 0);
});
test('archive capabilities stay read-only and uncertain leave ACK forces connection teardown', async () => {
  const c = setup(async () => ({ ...access, isArchived: true }));
  const stop = c.rooms.watch(USER_A);
  await flush();
  c.socket.ack(0);
  assert.equal(c.rooms.getSnapshot(USER_A).canRead, true);
  assert.equal(c.rooms.getSnapshot(USER_A).canWrite, false);
  stop();
  c.time.advance(5000);
  assert.equal(c.restarts, 1);
  c.rooms.dispose();
});
