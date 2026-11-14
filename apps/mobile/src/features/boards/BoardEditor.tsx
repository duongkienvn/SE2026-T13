import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { BoardRole } from '@kanban/shared';
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
  const [board, setBoard] = useState<Board | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const api = createBoardApi(data.api, identity);
  const detailKey = [...queryKeys.board(identity, id), 'edit-detail'] as const;
  const detail = useQuery({
    queryKey: detailKey,
    enabled: active,
    retry: false,
    queryFn: ({ signal }) => api.detail(id, signal),
  });
  useEffect(() => {
    const result = detail.data;
    if (
      !result ||
      board ||
      result.isArchived ||
      result.currentUserRole !== BoardRole.OWNER ||
      !result.capabilities.canManageBoard
    )
      return;
    setBoard(result);
    setName(result.name);
    setDescription(result.description ?? '');
  }, [detail.data, board]);
  const permitted =
    active &&
    !detail.isFetching &&
    !detail.isError &&
    data.resources.readable(detailKey) &&
    !!detail.data &&
    !detail.data.isArchived &&
    detail.data.currentUserRole === BoardRole.OWNER &&
    detail.data.capabilities.canManageBoard;
  const dirty =
    !!board &&
    (name !== board.name || description !== (board.description ?? ''));
  const close = () => {
    if (!busy.current) {
      if (dirty) setDiscard(true);
      else onDismiss();
    }
  };
  async function save() {
    if (!board || busy.current || !permitted) return;
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
    try {
      await api.update(id, input, new AbortController().signal);
      data.assertCurrent(identity);
      void data
        .invalidate(identity, [
          queryKeys.boardLists(identity),
          queryKeys.home(identity),
          queryKeys.board(identity, id),
        ])
        .catch(() => undefined);
      onDismiss();
    } catch (cause) {
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) {
        data.evict(identity, [queryKeys.board(identity, id)]);
        void data
          .invalidate(identity, [
            queryKeys.boardLists(identity),
            queryKeys.home(identity),
          ])
          .catch(() => undefined);
      }
      setError('Could not save board changes. Check access and try again.');
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
              disabled={!dirty || !permitted}
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
              disabled={!active || detail.isFetching}
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
