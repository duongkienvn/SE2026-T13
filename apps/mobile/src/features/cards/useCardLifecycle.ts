import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../../infrastructure/api/errors';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import type { KanbanCard, KanbanColumn } from '../boards/kanban-api';
import { isUncertainColumnWrite } from '../columns/mutations';
import { cardPosts } from './card-posts';
import { runCardMutation, type CardCommand } from './mutations';

type CardSheet =
  | { kind: 'board' | 'archived' }
  | { kind: 'create'; column: KanbanColumn }
  | {
      kind: 'actions' | 'rename' | 'move' | 'duplicate' | 'archive' | 'restore';
      card: KanbanCard;
    };

const success = {
  create: 'Card created.',
  update: 'Card renamed.',
  move: 'Card moved.',
  duplicate: 'Card duplicated.',
  archive: 'Card archived.',
  restore: 'Card restored to its original column.',
} as const;

const isReadSheet = (sheet: CardSheet) =>
  sheet.kind === 'board' || sheet.kind === 'archived';

export function useCardLifecycle({
  boardId,
  identity,
  writable,
  discard,
  discardWrites,
  recheckBoard,
  restoreToArchive = true,
}: {
  boardId: string;
  identity: SessionIdentity;
  writable: boolean;
  discard: boolean;
  discardWrites: boolean;
  recheckBoard: () => void;
  restoreToArchive?: boolean;
}) {
  const data = useMobileData();
  const active = useRef<AbortController | null>(null);
  const [sheet, setSheet] = useState<CardSheet | null>(null);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; at: number } | null>(
    null,
  );
  const [notice, setNotice] = useState('');
  const posts = cardPosts(data);
  const post = useSyncExternalStore(posts.subscribe, () =>
    posts.read(identity, boardId),
  );
  const uncertain = post?.status === 'uncertain' ? post : undefined;

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!discard && !discardWrites) return;
    active.current?.abort();
    active.current = null;
    setPending(false);
    setSheet((previous) =>
      discard ? null : previous && isReadSheet(previous) ? previous : null,
    );
    setTitle('');
    setFailure(null);
    setNotice('');
  }, [discard, discardWrites]);

  function open(next: CardSheet) {
    if (active.current || (!writable && !isReadSheet(next))) return;
    setSheet(next);
    setFailure(null);
    setNotice('');
    setTitle(
      next.kind === 'rename'
        ? next.card.title
        : next.kind === 'create' && uncertain?.kind === 'create'
          ? (uncertain.title ?? '')
          : '',
    );
  }

  function close() {
    if (active.current) return;
    setSheet((previous) =>
      previous?.kind === 'restore' && restoreToArchive
        ? { kind: 'archived' }
        : null,
    );
    setFailure(null);
    setTitle('');
  }

  async function run(command: CardCommand) {
    if (
      !writable ||
      active.current ||
      (posts.read(identity, boardId) &&
        (command.kind === 'create' || command.kind === 'duplicate'))
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    const stillCurrent = () =>
      !controller.signal.aborted && sameIdentity(identity, data.getIdentity());
    setPending(true);
    setFailure(null);
    try {
      const result = await runCardMutation(
        data,
        identity,
        boardId,
        command,
        controller.signal,
      );
      if (!stillCurrent()) return;
      setSheet(
        command.kind === 'restore' && restoreToArchive
          ? { kind: 'archived' }
          : null,
      );
      setTitle('');
      if (result) setNotice(success[command.kind]);
    } catch (error) {
      if (!stillCurrent()) return;
      setFailure({ error, at: Date.now() });
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.code === 'BOARD_ARCHIVED')
      )
        recheckBoard();
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }

  return {
    sheet,
    title,
    pending: pending || post?.status === 'pending',
    failure,
    notice,
    uncertain,
    writable,
    open,
    close,
    run,
    edit(value: string) {
      setTitle(value);
      setFailure(null);
    },
    acknowledge() {
      posts.acknowledge(identity, boardId);
      setFailure(null);
    },
    async reviewBoard(refresh: () => Promise<unknown>) {
      if (!uncertain || active.current) return;
      close();
      try {
        await refresh();
        posts.reviewed(identity, boardId, uncertain);
      } catch {
        // The Board shows its read error. Keep the gate until a refresh succeeds.
      }
    },
  };
}

export type CardLifecycle = ReturnType<typeof useCardLifecycle>;

export function cardActionMessage(error: unknown) {
  if (!(error instanceof ApiError)) return 'Couldn’t save the card. Try again.';
  if (isUncertainColumnWrite(error))
    return 'The change may have reached the server. Check the refreshed board before trying again.';
  switch (error.code) {
    case 'CARD_COLUMN_UNAVAILABLE':
      return 'The original column is unavailable. This card is still archived.';
    case 'CARD_NOT_ARCHIVED':
      return 'This card is already active. Check the refreshed archive.';
    case 'CARD_ARCHIVED':
      return 'This card is archived. Open Archived cards to see it.';
    case 'BOARD_ARCHIVED':
      return 'This board is archived.';
    case 'CARD_NOT_FOUND':
    case 'COLUMN_NOT_FOUND':
    case 'INVALID_CARD_MOVE':
      return 'The card or its position changed. Check the refreshed board.';
    case 'CARD_ORDER_CHANGED':
    case 'CARD_TITLE_CHANGED':
    case 'CARD_WRITE_PENDING':
    case 'CARD_POST_REVIEW_REQUIRED':
      return error.message;
  }
  if (error.kind === 'offline') return 'Reconnect to save the card.';
  if (error.status === 429) return 'Too many requests. Try again shortly.';
  if (error.status === 403 || error.status === 404)
    return 'This card or action is unavailable.';
  if (error.status === 400) return error.message;
  return 'Couldn’t save the card. Try again.';
}
