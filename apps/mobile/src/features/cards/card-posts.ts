import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';

type Draft = { kind: 'create' | 'duplicate'; title?: string };
type Pending = Draft & { status: 'pending' };
type Uncertain = Draft & { status: 'uncertain'; reviewed: boolean };
type CardPost = Pending | Uncertain;

function createCardPosts(data: MobileDataLayer) {
  const records = new Map<string, { boardId: string; record: CardPost }>();
  const listeners = new Set<() => void>();
  const key = (identity: SessionIdentity, boardId: string) =>
    JSON.stringify([
      identity.userId,
      identity.generation,
      boardId.toLowerCase(),
    ]);
  const notify = () => {
    for (const listener of listeners) listener();
  };
  data.resources.subscribeBoardTeardown((boardId) => {
    let changed = false;
    for (const [id, entry] of records) {
      if (boardId === undefined || entry.boardId === boardId.toLowerCase()) {
        records.delete(id);
        changed = true;
      }
    }
    if (changed) notify();
  });
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read(identity: SessionIdentity, boardId: string) {
      return records.get(key(identity, boardId))?.record;
    },
    begin(identity: SessionIdentity, boardId: string, draft: Draft) {
      const id = key(identity, boardId);
      if (records.has(id)) return undefined;
      const record: Pending = { ...draft, status: 'pending' };
      records.set(id, { boardId: boardId.toLowerCase(), record });
      notify();
      return (uncertain: boolean) => {
        const entry = records.get(id);
        // A late result cannot recreate a record torn down by session or access changes.
        if (entry?.record !== record) return;
        if (uncertain)
          entry.record = { ...record, status: 'uncertain', reviewed: false };
        else records.delete(id);
        notify();
      };
    },
    reviewed(identity: SessionIdentity, boardId: string, record: Uncertain) {
      const entry = records.get(key(identity, boardId));
      if (entry?.record !== record) return;
      entry.record = { ...record, reviewed: true };
      notify();
    },
    acknowledge(identity: SessionIdentity, boardId: string) {
      const id = key(identity, boardId);
      const record = records.get(id)?.record;
      if (record?.status !== 'uncertain' || !record.reviewed) return;
      records.delete(id);
      notify();
    },
  };
}

const stores = new WeakMap<
  MobileDataLayer,
  ReturnType<typeof createCardPosts>
>();
export function cardPosts(data: MobileDataLayer) {
  const existing = stores.get(data);
  if (existing) return existing;
  const store = createCardPosts(data);
  stores.set(data, store);
  return store;
}
