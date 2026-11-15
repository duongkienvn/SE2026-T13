import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../infrastructure/api/errors';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { columnName, type Column } from './api';
import {
  columnWriteNeedsAccessCheck,
  isUncertainColumnWrite,
  runColumnMutation,
  type ColumnCommand,
} from './mutations';

type Sheet =
  | { kind: 'create'; draft: string }
  | { kind: 'rename'; column: Column; draft: string }
  | { kind: 'actions' | 'remove'; column: Column };

export function useColumnManagement({
  boardId,
  identity,
  available,
  discard,
  recheckBoard,
}: {
  boardId: string;
  identity: SessionIdentity;
  available: boolean;
  discard: boolean;
  recheckBoard: () => void;
}) {
  const data = useMobileData();
  const active = useRef<AbortController | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; at: number } | null>(
    null,
  );
  const [uncertainDraft, setUncertainDraft] = useState<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const clearReveal = useCallback(() => setRevealId(null), []);

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!discard) return;
    active.current?.abort();
    active.current = null;
    setPending(false);
    setSheet(null);
    setFailure(null);
    setUncertainDraft(null);
    setRevealId(null);
  }, [discard]);

  function open(next: Sheet) {
    if (!available || active.current) return;
    setFailure(null);
    setSheet(next);
  }

  async function run(command: ColumnCommand) {
    if (
      !available ||
      active.current ||
      (command.kind === 'create' && uncertainDraft !== null)
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setFailure(null);
    try {
      const result = await runColumnMutation(
        data,
        identity,
        boardId,
        command,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        !sameIdentity(identity, data.getIdentity())
      )
        return;
      setSheet(null);
      if (result.kind === 'created') setRevealId(result.column.id);
    } catch (error) {
      if (
        controller.signal.aborted ||
        !sameIdentity(identity, data.getIdentity())
      )
        return;
      if (command.kind === 'create' && isUncertainColumnWrite(error))
        setUncertainDraft(command.name);
      setFailure({ error, at: Date.now() });
      if (columnWriteNeedsAccessCheck(error)) recheckBoard();
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }

  function save() {
    if (!sheet || (sheet.kind !== 'create' && sheet.kind !== 'rename')) return;
    try {
      const name = columnName(sheet.draft);
      if (
        sheet.kind === 'rename' &&
        name === sheet.column.name &&
        !active.current
      ) {
        setSheet(null);
        setFailure(null);
        return;
      }
      void run(
        sheet.kind === 'create'
          ? { kind: 'create', name }
          : { kind: 'rename', id: sheet.column.id, name },
      );
    } catch (error) {
      setFailure({ error, at: Date.now() });
    }
  }

  return {
    available,
    sheet,
    pending,
    failure,
    revealId,
    uncertain: uncertainDraft !== null,
    acknowledgeCreate: () => {
      setUncertainDraft(null);
      setFailure(null);
    },
    clearReveal,
    openCreate: () => open({ kind: 'create', draft: uncertainDraft ?? '' }),
    openActions: (column: Column) => open({ kind: 'actions', column }),
    openRename: (column: Column) =>
      open({ kind: 'rename', column, draft: column.name }),
    openRemove: (column: Column) => open({ kind: 'remove', column }),
    dismiss: () => {
      if (!active.current) {
        setSheet(null);
        setFailure(null);
      }
    },
    edit: (draft: string) => {
      setSheet((current) =>
        current?.kind === 'create' || current?.kind === 'rename'
          ? { ...current, draft }
          : current,
      );
      setFailure(null);
    },
    save,
    run,
  };
}

export type ColumnManagement = ReturnType<typeof useColumnManagement>;

export function columnIssueMessage(error: unknown) {
  if (!(error instanceof ApiError))
    return 'Couldn’t save the column. Try again.';
  if (error.code === 'COLUMN_NOT_EMPTY')
    return 'This column still contains active or archived cards.';
  if (error.code === 'BOARD_ARCHIVED') return 'This board is archived.';
  if (error.code === 'COLUMN_NOT_FOUND' || error.code === 'INVALID_COLUMN_MOVE')
    return 'The column or its position changed. Check the refreshed board before trying again.';
  if (
    error.status === 400 ||
    error.code === 'COLUMN_ORDER_LOADING' ||
    error.code === 'COLUMN_WRITE_PENDING'
  )
    return error.message;
  if (error.status === 403 || error.status === 404)
    return 'Column editing is unavailable. Check your board access.';
  if (error.status === 429) return 'Too many requests. Try again shortly.';
  if (error.kind === 'offline') return 'Reconnect to save the column.';
  if (isUncertainColumnWrite(error))
    return 'The request may have reached the server. Check the refreshed board before trying again.';
  return 'Couldn’t save the column. Try again.';
}
