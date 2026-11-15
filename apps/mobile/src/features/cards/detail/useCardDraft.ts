import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../infrastructure/api/errors';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { sameIdentity } from '../../../infrastructure/api/session-client';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer';
import { queryKeys } from '../../../infrastructure/query/keys';
import { createCardApi } from '../api';
import type { Card } from '../decoder';
import { runCardMutation } from '../mutations';
import {
  draftValue,
  hasDraftConflict,
  isDraftDirty,
  type CardTextDraft,
  type CardTextField,
} from './draft';

/** In-memory only; the keyed route boundary owns user/session/Board/Card lifetime. */
export function useCardDraft({
  data,
  identity,
  boardId,
  cardId,
  card,
  canEdit,
  onUnavailable,
}: {
  data: MobileDataLayer;
  identity: SessionIdentity;
  boardId: string;
  cardId: string;
  card: Card | null;
  canEdit: boolean;
  onUnavailable: () => void;
}) {
  const [draft, setDraft] = useState<CardTextDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; at: number } | null>(
    null,
  );
  const [remote, setRemote] = useState<Card | null>(null);
  const active = useRef<AbortController | null>(null);
  const latest = useRef({ card, canEdit, draft });
  latest.current = { card, canEdit, draft };
  useEffect(() => () => active.current?.abort(), []);
  // An authoritative refetch supersedes a pre-save read, even when its timestamp
  // is unchanged. Comparing the field below avoids metadata-only conflicts.
  useEffect(() => setRemote(null), [card]);
  const server = remote ?? card;
  const conflict =
    !!server && hasDraftConflict(draft, draft ? server[draft.field] : null);
  const clear = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setDraft(null);
    setRemote(null);
    setFailure(null);
    setPending(false);
  }, []);

  function cancel() {
    if (active.current) return;
    setDraft(null);
    setFailure(null);
    setRemote(null);
  }

  async function save(acknowledge = false) {
    const editing = latest.current.draft;
    if (!editing || !server || active.current || !latest.current.canEdit)
      return;
    let input: string | null;
    try {
      input = draftValue(editing);
    } catch (error) {
      setFailure({ error, at: Date.now() });
      return;
    }
    if (!isDraftDirty(editing)) {
      cancel();
      return;
    }
    const acknowledgedValue = acknowledge
      ? server[editing.field]
      : editing.baseline;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setFailure(null);
    const key = queryKeys.card(identity, boardId, cardId);
    const current = () =>
      !controller.signal.aborted &&
      sameIdentity(identity, data.getIdentity()) &&
      data.resources.readable(key);
    try {
      const fence = data.resources.capture(key, false);
      // PATCH has no description revision/CAS. Re-read immediately before writing;
      // a later concurrent change can still race this read. Never claim otherwise.
      const fresh = await createCardApi(data.api, identity, boardId).getCard(
        cardId,
        controller.signal,
      );
      if (!current()) return;
      fence();
      setRemote(fresh);
      if (fresh.isArchived || !latest.current.canEdit) {
        void data.invalidateHints(identity, [key]).catch(() => undefined);
        throw new ApiError('http', { status: 409, code: 'CARD_ARCHIVED' });
      }
      if (fresh[editing.field] !== acknowledgedValue) return;
      const result = await runCardMutation(
        data,
        identity,
        boardId,
        {
          kind: 'update',
          id: cardId,
          patch:
            editing.field === 'title'
              ? { title: input! }
              : { description: input },
          // Title's existing MOB-17 server guard is real; description has no CAS.
          ...(editing.field === 'title' ? { expectedTitle: fresh.title } : {}),
        },
        controller.signal,
      );
      if (!current()) return;
      fence();
      if (!result || result[editing.field] !== input)
        throw new Error(
          'The saved value was not confirmed. Your draft is retained.',
        );
      // Do not overwrite a newer authoritative query result with the PATCH snapshot.
      setDraft(null);
      setRemote(null);
    } catch (error) {
      if (current()) {
        if (error instanceof ApiError && [403, 404].includes(error.status)) {
          onUnavailable();
        } else setFailure({ error, at: Date.now() });
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }

  return {
    draft,
    pending,
    failure,
    conflict,
    dirty: isDraftDirty(draft),
    clear,
    start(field: CardTextField) {
      if (!canEdit || !card || active.current || draft) return;
      setDraft({ field, baseline: card[field], value: card[field] ?? '' });
      setFailure(null);
      setRemote(null);
    },
    edit(value: string) {
      if (active.current) return;
      setDraft((previous) => previous && { ...previous, value });
      setFailure(null);
    },
    loadLatest() {
      if (!draft || !server || active.current) return;
      setDraft({
        ...draft,
        baseline: server[draft.field],
        value: server[draft.field] ?? '',
      });
      setFailure(null);
    },
    cancel,
    save,
  };
}

export type CardDraftController = ReturnType<typeof useCardDraft>;
