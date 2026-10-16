import {
  RealtimeServerEvent,
  type RealtimeServerEvents,
  type RealtimeClientEvents,
} from '../src/index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const exactKeys: Equal<
  keyof RealtimeServerEvents,
  (typeof RealtimeServerEvent)[keyof typeof RealtimeServerEvent]
> = true;
void exactKeys;

declare const server: RealtimeServerEvents;
declare const client: RealtimeClientEvents;
const column = { boardId: 'board', columnId: 'column' };
const card = { ...column, cardId: 'card' };
const member = { boardId: 'board', userId: 'user' };
server['column:created'](column);
server['column:updated'](column);
server['column:moved'](column);
server['column:deleted'](column);
server['card:created'](card);
server['card:updated'](card);
server['card:archived'](card);
server['card:assignees-changed'](card);
server['card:moved']({
  boardId: 'board',
  cardId: 'card',
  fromColumnId: 'a',
  toColumnId: 'b',
});
server['member:added'](member);
server['member:role-changed'](member);
server['member:removed'](member);
client['board:join']({ boardId: 'board' }, (ack) => {
  void ack.success;
});
// @ts-expect-error move requires both columns
server['card:moved'](card);
// @ts-expect-error membership requires target user
server['member:removed'](column);
// @ts-expect-error no sensitive fields in payload literals
server['card:created']({ ...card, title: 'private' });
// @ts-expect-error clients have no business commands
client['card:created'](card);
// @ts-expect-error no catch-all event name
server['unreviewed:event'](card);
