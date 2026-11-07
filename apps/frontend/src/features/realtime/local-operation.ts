import type { QueryClient } from '@tanstack/react-query';
import type { InvalidationTarget } from './event-invalidation';

type LocalEvent =
  'comment:created' | 'comment:updated' | 'comment:deleted' | 'card:updated';
interface Operation {
  event: LocalEvent;
  boardId: string;
  cardId: string;
  state: 'pending' | 'succeeded';
  buffered?: {
    targets: InvalidationTarget[];
    enqueue: (targets: InvalidationTarget[]) => void;
  };
  timer: ReturnType<typeof setTimeout>;
}

const clients = new WeakMap<QueryClient, Map<string, Operation>>();
const lifetimeMs = 30_000;

/** A tab-local opaque ID only identifies one request, never a user or session. */
export function beginLocalOperation(
  client: QueryClient,
  event: LocalEvent,
  boardId: string,
  cardId: string,
) {
  let entries = clients.get(client);
  if (!entries) clients.set(client, (entries = new Map()));
  if (
    entries.size >= 128 ||
    typeof crypto === 'undefined' ||
    typeof crypto.randomUUID !== 'function'
  )
    return undefined;
  let id: string;
  try {
    id = crypto.randomUUID();
  } catch {
    return undefined;
  }
  const map = entries;
  const operation: Operation = {
    event,
    boardId: boardId.toLowerCase(),
    cardId: cardId.toLowerCase(),
    state: 'pending',
    timer: setTimeout(() => {
      if (map.get(id) !== operation) return;
      map.delete(id);
      if (operation.state === 'pending' && operation.buffered)
        operation.buffered.enqueue(operation.buffered.targets);
    }, lifetimeMs),
  };
  map.set(id, operation);
  const remove = () => {
    clearTimeout(operation.timer);
    map.delete(id);
  };
  return {
    id,
    success() {
      if (map.get(id) !== operation) return;
      if (operation.buffered) remove();
      else operation.state = 'succeeded';
    },
    failure() {
      if (map.get(id) !== operation) return;
      remove();
      if (operation.buffered)
        operation.buffered.enqueue(operation.buffered.targets);
    },
  };
}

/** Returns true only for this tab's first matching hint; all others pass through. */
export function consumeLocalHint(
  client: QueryClient,
  event: string,
  payload: {
    boardId: string;
    cardId?: unknown;
    operationId?: unknown;
    changeScope?: unknown;
  },
  targets: InvalidationTarget[],
  enqueue: (targets: InvalidationTarget[]) => void,
): boolean {
  if (
    typeof payload.operationId !== 'string' ||
    typeof payload.cardId !== 'string' ||
    (event === 'card:updated' && payload.changeScope !== 'attachments')
  )
    return false;
  const map = clients.get(client);
  const operation = map?.get(payload.operationId);
  if (
    !operation ||
    operation.event !== event ||
    operation.boardId !== payload.boardId.toLowerCase() ||
    operation.cardId !== payload.cardId.toLowerCase() ||
    operation.buffered
  )
    return false;
  if (operation.state === 'pending') operation.buffered = { targets, enqueue };
  else {
    clearTimeout(operation.timer);
    map?.delete(payload.operationId);
  }
  return true;
}

/** A session transition must never deliver an old buffered hint into a new session. */
export function clearLocalOperations(client: QueryClient) {
  const entries = clients.get(client);
  if (!entries) return;
  for (const operation of entries.values()) clearTimeout(operation.timer);
  entries.clear();
}
