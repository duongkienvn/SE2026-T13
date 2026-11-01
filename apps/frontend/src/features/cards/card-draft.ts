import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import type { WallClock } from './card-dates';
import { normalizeCardDescription } from './validation';

export interface DatesValue {
  start: WallClock;
  due: WallClock;
}

/**
 * Unsent Card Detail edits. A field is being edited while it is present;
 * `base` is the server value when editing began, so a later remote change
 * can be told apart from the user's own text.
 */
export interface CardDraft {
  readonly title?: { readonly base: string; readonly value: string };
  readonly description?: {
    readonly base: string | null;
    readonly value: string;
  };
  readonly dates?: {
    readonly base: { startDate: string | null; dueDate: string | null };
    /** The zone the wall clocks were entered in. */
    readonly timeZone: string;
    readonly initial: DatesValue;
    readonly value: DatesValue;
  };
}
export type CardDraftField = keyof CardDraft;

export const cardDraftKey = (boardId: string, cardId: string) =>
  ['card-draft', boardId.toLowerCase(), cardId.toLowerCase()] as const;

export function clearBoardDrafts(client: QueryClient, boardId: string): void {
  client.removeQueries({ queryKey: ['card-draft', boardId.toLowerCase()] });
}

const sameDates = (a: DatesValue, b: DatesValue) =>
  a.start.date === b.start.date &&
  a.start.time === b.start.time &&
  a.due.date === b.due.date &&
  a.due.time === b.due.time;

/** True when saving the field would change something. */
export function isFieldDirty(draft: CardDraft, field: CardDraftField): boolean {
  if (field === 'title')
    return !!draft.title && draft.title.value.trim() !== draft.title.base;
  if (field === 'description')
    return (
      !!draft.description &&
      normalizeCardDescription(draft.description.value) !==
        draft.description.base
    );
  return !!draft.dates && !sameDates(draft.dates.value, draft.dates.initial);
}

export const isDraftDirty = (draft: CardDraft) =>
  (['title', 'description', 'dates'] as const).some((field) =>
    isFieldDirty(draft, field),
  );

/**
 * The card's draft, kept in the query cache (never persisted) so it survives
 * a remount, and removed with the board's protected data on access loss.
 */
export function useCardDraft(boardId: string, cardId: string) {
  const client = useQueryClient();
  const key = cardDraftKey(boardId, cardId);
  const [draft, setDraft] = useState<CardDraft>(
    () => client.getQueryData<CardDraft>(key) ?? {},
  );
  const keyString = key.join('/');

  useEffect(() => {
    client.setQueryDefaults(['card-draft'], { gcTime: Infinity });
    const queryKey = keyString.split('/');
    if (Object.keys(draft).length > 0) client.setQueryData(queryKey, draft);
    else client.removeQueries({ queryKey, exact: true });
  }, [client, keyString, draft]);

  const update = useCallback(
    <F extends CardDraftField>(field: F, value: CardDraft[F]) =>
      setDraft((current) => {
        const next = { ...current };
        if (value === undefined) delete next[field];
        else next[field] = value;
        return next;
      }),
    [],
  );
  const clear = useCallback(() => setDraft({}), []);
  return { draft, update, clear };
}

/**
 * Asks before leaving the card route (Close, Escape, Back/Forward, another
 * card or page) and before a reload while `dirty`. The ref lets a caller
 * discard the draft and navigate in the same tick.
 */
export function useLeaveGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload((event) => {
    if (dirtyRef.current) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const release = useCallback(() => {
    dirtyRef.current = false;
  }, []);
  return { blocker, release };
}

/**
 * Small unsent inputs inside sections (a checklist item being typed, a label
 * being renamed) report here, so the leave guard covers them as well.
 */
export const DirtyRegistryContext = createContext<
  (id: string, dirty: boolean) => void
>(() => {});

export function useDirtyRegistry() {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());
  const report = useCallback(
    (id: string, dirty: boolean) =>
      setDirtyIds((current) => {
        if (current.has(id) === dirty) return current;
        const next = new Set(current);
        if (dirty) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const reset = useCallback(() => setDirtyIds(new Set()), []);
  return { anyDirty: dirtyIds.size > 0, report, reset };
}

/** Reports `dirty` for this component until it unmounts. */
export function useReportDirty(dirty: boolean) {
  const report = useContext(DirtyRegistryContext);
  const id = useId();
  useEffect(() => {
    report(id, dirty);
  }, [report, id, dirty]);
  useEffect(() => () => report(id, false), [report, id]);
}
