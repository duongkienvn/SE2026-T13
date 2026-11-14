import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { BoardRole, type BoardBackgroundPresetId } from '@kanban/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import {
  BottomSheet,
  Button,
  Skeleton,
  TextField,
  UnsavedChangesPrompt,
  typography,
  useTheme,
} from '../../ui';
import { createBoardApi, type decodeBoard } from './api';
import { BackgroundPicker } from './BackgroundPicker';
import { isBoardPreset } from '../home/presets';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../workspaces/status';

type Board = ReturnType<typeof decodeBoard>;
export function BoardEditor({
  identity,
  id,
  active,
  onDismiss,
}: {
  identity: SessionIdentity;
  id: string;
  active: boolean;
  onDismiss: () => void;
}) {
  const data = useMobileData();
  const c = useTheme();
  const online = useWorkspaceOnline();
  const [board, setBoard] = useState<Board | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preset, setPreset] = useState<BoardBackgroundPresetId | undefined>();
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<{
    error: ApiError;
    at: number;
  } | null>(null);
  const retryReady = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  const busy = useRef(false);
  const api = createBoardApi(data.api, identity);
  const detailKey = [...queryKeys.board(identity, id), 'edit-detail'] as const;
  const detail = useQuery({
    queryKey: detailKey,
    enabled: active,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: ({ signal }) => api.detail(id, signal),
  });
  useEffect(() => {
    const result = detail.data;
    if (
      !result ||
      !detail.isFetchedAfterMount ||
      detail.isFetching ||
      board ||
      result.isArchived ||
      result.currentUserRole !== BoardRole.OWNER ||
      !result.capabilities.canManageBoard
    )
      return;
    setBoard(result);
    setName(result.name);
    setDescription(result.description ?? '');
    setPreset(
      isBoardPreset(result.backgroundPreset)
        ? result.backgroundPreset
        : undefined,
    );
  }, [detail.data, detail.isFetchedAfterMount, detail.isFetching, board]);
  const permitted =
    active &&
    detail.isFetchedAfterMount &&
    !detail.isFetching &&
    !detail.isError &&
    data.resources.readable(detailKey) &&
    !!detail.data &&
    !detail.data.isArchived &&
    detail.data.currentUserRole === BoardRole.OWNER &&
    detail.data.capabilities.canManageBoard;
  const dirtyMetadata =
    !!board &&
    (name !== board.name || description !== (board.description ?? ''));
  const dirtyBackground =
    !!detail.data && !!preset && preset !== detail.data.backgroundPreset;
  const dirty = dirtyMetadata || dirtyBackground;
  const close = () => {
    if (!busy.current) {
      if (dirty) setDiscard(true);
      else onDismiss();
    }
  };
  async function save() {
    if (
      !board ||
      busy.current ||
      !online ||
      !permitted ||
      !canRetryWorkspace(failure?.error, failure?.at ?? 0)
    )
      return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120 || description.length > 2000) {
      setError(
        'Enter a name of 1–120 characters and a description of at most 2000 characters.',
      );
      return;
    }
    const input = {
      ...(name !== board.name ? { name: trimmed } : {}),
      ...(description !== (board.description ?? '')
        ? { description: description || null }
        : {}),
    };
    if (!Object.keys(input).length) return;
    busy.current = true;
    setPending(true);
    setError('');
    setFailure(null);
    try {
      const updated = await api.update(id, input, new AbortController().signal);
      data.assertCurrent(identity);
      setBoard(updated);
      data.queryClient.setQueryData(detailKey, updated);
      void data
        .invalidate(identity, [
          queryKeys.boardLists(identity),
          queryKeys.home(identity),
          queryKeys.board(identity, id),
        ])
        .catch(() => undefined);
      if (dirtyBackground)
        setError(
          'Board details saved. Apply or discard the background choice.',
        );
      else onDismiss();
    } catch (cause) {
      if (cause instanceof ApiError)
        setFailure({ error: cause, at: Date.now() });
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) {
        data.evict(identity, [queryKeys.board(identity, id)]);
        void data
          .invalidate(identity, [
            queryKeys.boardLists(identity),
            queryKeys.home(identity),
          ])
          .catch(() => undefined);
      }
      setError(
        cause instanceof ApiError
          ? workspaceErrorMessage(cause)
          : 'Could not save board changes. Check access and try again.',
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function saveBackground() {
    if (
      !permitted ||
      !online ||
      !detail.data ||
      !preset ||
      !dirtyBackground ||
      busy.current ||
      !canRetryWorkspace(failure?.error, failure?.at ?? 0)
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    setFailure(null);
    try {
      const updated = await api.background(
        id,
        preset,
        detail.data.backgroundVersion,
        new AbortController().signal,
      );
      data.assertCurrent(identity);
      data.queryClient.setQueryData(detailKey, updated);
      void data
        .invalidate(identity, [
          queryKeys.boardLists(identity),
          queryKeys.home(identity),
        ])
        .catch(() => undefined);
    } catch (cause) {
      if (cause instanceof ApiError)
        setFailure({ error: cause, at: Date.now() });
      if (
        cause instanceof ApiError &&
        cause.status === 409 &&
        cause.code === 'BACKGROUND_CONFLICT'
      ) {
        await detail.refetch();
        setError(
          'The background changed elsewhere. Review it and apply your choice again.',
        );
      } else {
        if (cause instanceof ApiError && [403, 404].includes(cause.status))
          data.evict(identity, [queryKeys.board(identity, id)]);
        setError(
          'Could not change the background. Check access and try again.',
        );
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <BottomSheet
        visible
        title="Edit board"
        onDismiss={close}
        dismissible={!pending}
        showHandle
        respectReducedMotion
      >
        {detail.isPending && (
          <Skeleton height={80} label="Checking board access" />
        )}
        {board && permitted && (
          <>
            <TextField
              label="Board name"
              value={name}
              onChangeText={setName}
              maxLength={120}
              editable={!pending}
            />
            <TextField
              label="Board description (optional)"
              value={description}
              onChangeText={setDescription}
              maxLength={2000}
              multiline
              editable={!pending}
            />
            <Button
              label="Save board"
              onPress={() => void save()}
              loading={pending}
              disabled={!dirtyMetadata || !permitted || !online || !retryReady}
            />
            <BackgroundPicker
              identity={identity}
              value={preset}
              onChange={setPreset}
              disabled={pending || !online}
            />
            <Button
              label="Apply background"
              variant="secondary"
              onPress={() => void saveBackground()}
              loading={pending}
              disabled={
                !dirtyBackground || !permitted || !online || !retryReady
              }
            />
          </>
        )}
        {!detail.isPending && !permitted && (
          <>
            <Text style={[typography.body, { color: c.danger }]}>
              Board editing is unavailable.
            </Text>
            <Button
              label="Check board access"
              variant="secondary"
              disabled={!active || !online || detail.isFetching}
              onPress={() => void detail.refetch()}
            />
          </>
        )}
        {!!error && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.danger }]}
          >
            {error}
          </Text>
        )}
        <Button
          label="Cancel"
          variant="secondary"
          onPress={close}
          disabled={pending}
        />
      </BottomSheet>
      <UnsavedChangesPrompt
        visible={discard}
        onDiscard={onDismiss}
        onKeepEditing={() => setDiscard(false)}
      />
    </>
  );
}
