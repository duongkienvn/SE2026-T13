import {
  BoardRole,
  BoardVisibility,
  WorkspaceType,
  type StarterBoardRemovalPreview,
} from '@kanban/shared';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../infrastructure/api/errors';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import {
  useBoardRealtime,
  useRealtime,
} from '../../infrastructure/realtime/RealtimeProvider';
import { ResourceBoundary } from '../../navigation/resource-boundary';
import type { ResourceId } from '../../navigation/routes';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  ErrorState,
  ScreenHeader,
  SegmentedControl,
  Skeleton,
  Surface,
  TextField,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import type { WorkspaceSummary } from '../workspaces/decoder';
import { workspaceDirectoryOptions } from '../workspaces/queries';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../workspaces/status';
import { createBoardApi } from './api';
import { BoardEditor } from './BoardEditor';
import { BoardStar } from './BoardStar';
import { isAccessDenied } from './kanban-api';
import {
  createBoardLifecycleApi,
  visibilityLabel,
  visibilityOptions,
  type LifecycleBoard,
} from './lifecycle-api';
import { boardStarKey } from './star';

type Sheet = 'edit' | 'visibility' | 'move' | 'archive' | 'restore' | 'sample';
type Failure = { error: unknown; at: number };

export function BoardSettingsScreen({
  boardId,
}: {
  boardId: ResourceId | null;
}) {
  const session = useSessionSnapshot();
  const identity = useMemo(
    () =>
      session.status === 'authenticated'
        ? { userId: session.user.id, generation: session.generation }
        : null,
    [session],
  );
  if (!boardId || !identity) return <ResourceBoundary access="unavailable" />;
  return (
    <SettingsEntry
      key={`${identity.userId}:${identity.generation}:${boardId}`}
      boardId={boardId}
      identity={identity}
    />
  );
}

export function boardSettingsKey(identity: SessionIdentity, boardId: string) {
  return [...queryKeys.board(identity, boardId), 'settings'] as const;
}

/** Owner-only actions follow the server's explicit Board role and capability. */
export function boardOwnerState(board: LifecycleBoard | null | undefined) {
  const owner =
    !!board &&
    board.currentUserRole === BoardRole.OWNER &&
    board.capabilities.canManageBoard;
  return {
    ownsActive: owner && !board.isArchived,
    canRestore:
      !!board &&
      board.isArchived &&
      board.currentUserRole === BoardRole.OWNER &&
      board.capabilities.canRestoreBoard,
  };
}

function SettingsEntry({
  boardId,
  identity,
}: {
  boardId: ResourceId;
  identity: SessionIdentity;
}) {
  const data = useMobileData();
  const realtime = useRealtime();
  const focused = useIsFocused();
  const online = useWorkspaceOnline();
  const room = useBoardRealtime(boardId, focused, true);
  const c = useTheme();
  const key = boardSettingsKey(identity, boardId);
  const checking = room.status === 'checking';
  const revoked = room.status === 'unavailable';
  const detail = useQuery({
    queryKey: key,
    enabled: focused && !checking && !revoked,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    async queryFn({ signal }) {
      const current = data.resources.captureBoardProbe(boardId);
      let board;
      try {
        board = await createBoardApi(data.api, identity).detail(
          boardId,
          signal,
        );
      } catch (error) {
        if (!signal.aborted && isAccessDenied(error)) {
          data.assertCurrent(identity);
          current();
          realtime.revokeBoard(boardId);
        }
        throw error;
      }
      if (signal.aborted) throw new ApiError('aborted');
      data.assertCurrent(identity);
      current();
      data.resources.confirmBoard(
        boardId,
        !board.isArchived && board.capabilities.canWriteBoard,
        board.workspaceId,
      );
      return board;
    },
  });
  const retryReady = useWorkspaceRetryReady(
    detail.error,
    detail.errorUpdatedAt,
  );
  const verified =
    !revoked &&
    !checking &&
    online &&
    !!detail.data &&
    detail.isFetchedAfterMount &&
    !detail.isError &&
    data.resources.readable(key);
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      {revoked || isAccessDenied(detail.error) ? (
        <ErrorState
          title="Board unavailable"
          description="This destination is unavailable."
        />
      ) : !online || detail.isPaused ? (
        <ErrorState
          title="Connection unavailable"
          description="Reconnect to verify Board access."
        />
      ) : verified && detail.data ? (
        <SettingsContent
          boardId={boardId}
          board={detail.data}
          identity={identity}
          focused={focused}
          refreshing={detail.isFetching}
          recheck={() => void detail.refetch()}
        />
      ) : detail.isError && !detail.isFetching ? (
        <ErrorState
          title="Couldn’t open board settings"
          description={workspaceErrorMessage(detail.error)}
          action={
            <Button
              label="Retry board settings"
              disabled={!retryReady}
              onPress={() => void detail.refetch()}
            />
          }
        />
      ) : (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton width={160} height={28} label="Checking board access" />
          <Skeleton height={120} />
        </View>
      )}
    </SafeAreaView>
  );
}

function roleLabel(board: LifecycleBoard) {
  if (board.currentUserRole === BoardRole.OWNER) return 'Owner';
  if (board.currentUserRole === BoardRole.MEMBER) return 'Member';
  return 'Workspace viewer · Read only';
}

function SettingsContent({
  boardId,
  board,
  identity,
  focused,
  refreshing,
  recheck,
}: {
  boardId: ResourceId;
  board: LifecycleBoard;
  identity: SessionIdentity;
  focused: boolean;
  refreshing: boolean;
  recheck: () => void;
}) {
  const c = useTheme();
  const data = useMobileData();
  const router = useRouter();
  const realtime = useRealtime();
  const online = useWorkspaceOnline();
  const lifecycle = createBoardLifecycleApi(data.api, identity);
  const key = boardSettingsKey(identity, boardId);
  const { ownsActive, canRestore } = boardOwnerState(board);
  const sampleHint =
    board.isStarterBoard && board.currentUserRole === BoardRole.OWNER;
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const retryReady = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  const policy = useQuery({
    queryKey: [...key, 'policy'],
    enabled: focused && ownsActive,
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => lifecycle.policy(boardId, signal),
  });
  const directory = useQuery({
    ...workspaceDirectoryOptions(data, identity),
    enabled: focused,
  });
  const preview = useQuery({
    queryKey: [...key, 'sample-removal'],
    enabled: focused && sampleHint,
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => lifecycle.samplePreview(boardId, signal),
  });
  const star = useQuery({
    queryKey: boardStarKey(identity, boardId),
    enabled: focused,
    queryFn: ({ signal }) =>
      createBoardApi(data.api, identity).state(boardId, signal),
  });
  // Close dialogs that the latest server state no longer authorizes.
  useEffect(() => {
    if (busy.current) return;
    if (
      (sheet === 'visibility' || sheet === 'move' || sheet === 'archive') &&
      !ownsActive
    )
      setSheet(null);
    if (sheet === 'restore' && !canRestore) setSheet(null);
  }, [sheet, ownsActive, canRestore]);
  const workspace = directory.data?.find((row) => row.id === board.workspaceId);
  const canChangeVisibility =
    ownsActive && policy.data?.canChangeVisibility === true;
  const sampleReview = sampleHint ? preview.data : undefined;
  const sampleBlocked =
    sampleHint &&
    preview.error instanceof ApiError &&
    preview.error.status === 409 &&
    preview.error.code === 'STARTER_BOARD_REMOVAL_UNSAFE';
  const ready = online && focused && !refreshing && retryReady;

  function workspaceKeys(ids: readonly string[]) {
    return [...new Set(ids)].map((id) => queryKeys.workspace(identity, id));
  }
  function settle(saved: LifecycleBoard, workspaces: readonly string[]) {
    data.assertCurrent(identity);
    data.resources.confirmBoard(
      boardId,
      !saved.isArchived && saved.capabilities.canWriteBoard,
      saved.workspaceId,
    );
    data.queryClient.setQueryData(key, saved);
    void data
      .invalidate(identity, [
        queryKeys.board(identity, boardId),
        queryKeys.boardLists(identity),
        queryKeys.home(identity),
        ...workspaceKeys(workspaces),
      ])
      .catch(() => undefined);
  }
  /** One command at a time; recoverable failures keep the open dialog and input. */
  async function command<T>(
    run: (signal: AbortSignal) => Promise<T>,
    done: (result: T) => void,
    keepOpen: (error: unknown) => boolean = () => true,
  ) {
    if (
      busy.current ||
      !online ||
      !focused ||
      !canRetryWorkspace(failure?.error, failure?.at ?? 0)
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    setNotice('');
    setFailure(null);
    try {
      const result = await run(new AbortController().signal);
      data.assertCurrent(identity);
      if (!mounted.current) return;
      done(result);
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.kind === 'session-changed') {
        recheck();
        setSheet(null);
        return;
      }
      setFailure({ error: cause, at: Date.now() });
      const denied = isAccessDenied(cause);
      const conflict = cause instanceof ApiError && cause.status === 409;
      setError(
        denied
          ? 'Your board role or workspace rules no longer allow this. Board access is being rechecked.'
          : conflict
            ? 'This board changed meanwhile. Review the latest details and try again.'
            : workspaceErrorMessage(cause),
      );
      // The server decides; never keep an optimistic assumption after denial
      // or conflict. A delayed/unknown outcome is also rechecked.
      recheck();
      if (denied || conflict || !keepOpen(cause)) setSheet(null);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  const archive = () =>
    void command(
      (signal) => lifecycle.archive(boardId, signal),
      (saved) => {
        settle(saved, [saved.workspaceId]);
        setSheet(null);
        setNotice(`Board “${saved.name}” archived. It is now read only.`);
      },
      () => false,
    );
  const restore = () =>
    void command(
      (signal) => lifecycle.restore(boardId, signal),
      (saved) => {
        settle(saved, [saved.workspaceId]);
        setSheet(null);
        setNotice(`Board “${saved.name}” restored.`);
      },
      () => false,
    );
  const changeVisibility = (value: BoardVisibility) =>
    void command(
      (signal) => lifecycle.visibility(boardId, value, signal),
      (saved) => {
        settle(saved, [saved.workspaceId]);
        void data
          .invalidate(identity, [[...key, 'policy']])
          .catch(() => undefined);
        setSheet(null);
        setNotice(
          `Board visibility updated to ${visibilityLabel(saved.visibility)}.`,
        );
      },
    );
  const move = (destination: string) => {
    const source = board.workspaceId;
    void command(
      (signal) => lifecycle.move(boardId, source, destination, signal),
      (saved) => {
        settle(saved, [source, destination]);
        void data
          .invalidate(identity, [queryKeys.workspaces(identity)])
          .catch(() => undefined);
        setSheet(null);
        const name =
          directory.data?.find((row) => row.id === saved.workspaceId)?.name ??
          'the selected workspace';
        setNotice(
          saved.workspaceId === source
            ? 'The board is already in this workspace.'
            : `Board moved to ${name}. Its link and board members are unchanged; visibility is now Private.`,
        );
      },
    );
  };
  const removeSample = (
    review: StarterBoardRemovalPreview,
    confirmation: string,
    onRejected: (message: string) => void,
  ) => {
    if (
      busy.current ||
      !online ||
      confirmation !== review.confirmation ||
      preview.isFetching
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    const workspaceId = board.workspaceId;
    lifecycle
      .removeSample(boardId, review, new AbortController().signal)
      .then(() => {
        data.assertCurrent(identity);
        // Permanently removed: fence and evict every protected cache first.
        realtime.revokeBoard(boardId);
        data.evict(identity, [queryKeys.board(identity, boardId)]);
        void data
          .invalidate(identity, [
            queryKeys.boardLists(identity),
            queryKeys.home(identity),
            ...workspaceKeys([workspaceId]),
          ])
          .catch(() => undefined);
        if (mounted.current) router.replace('/boards');
      })
      .catch((cause) => {
        if (!mounted.current) return;
        if (cause instanceof ApiError && cause.kind === 'session-changed') {
          setSheet(null);
          recheck();
          return;
        }
        const code = cause instanceof ApiError ? cause.code : undefined;
        // Never retry a destructive request: always require a fresh review.
        void preview.refetch();
        if (code === 'STARTER_BOARD_CHANGED')
          onRejected(
            'The sample board changed. Review the updated details and type the confirmation again.',
          );
        else if (code === 'STARTER_BOARD_REMOVAL_UNSAFE') {
          setSheet(null);
          setError(
            'Sample removal is unavailable for this board now. Nothing was removed.',
          );
        } else if (isAccessDenied(cause)) {
          setSheet(null);
          recheck();
          setError('Sample removal is unavailable. Nothing was removed.');
        } else
          onRejected(
            cause instanceof ApiError && cause.status === 400
              ? 'Type the exact confirmation phrase to remove this board.'
              : `${workspaceErrorMessage(cause)} Nothing was removed unless the board is gone after refreshing.`,
          );
      })
      .finally(() => {
        busy.current = false;
        if (mounted.current) setPending(false);
      });
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader
        title="Board settings"
        subtitle={board.name}
        trailing={
          star.data ? (
            <BoardStar
              identity={identity}
              id={boardId}
              name={board.name}
              starred={star.data.isStarred}
              updatedAt={star.dataUpdatedAt}
              disabled={!online}
            />
          ) : undefined
        }
      />
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.success }]}
        >
          {notice}
        </Text>
      )}
      {!!error && !sheet && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.danger }]}
        >
          {error}
        </Text>
      )}
      {board.isArchived && (
        <Text style={[typography.body, { color: c.warning }]}>
          This board is archived. It can be viewed but no longer changed.
        </Text>
      )}
      <Surface>
        <View style={{ gap: spacing.sm }}>
          <Text
            accessibilityRole="header"
            style={[typography.section, { color: c.text }]}
          >
            Details
          </Text>
          <Detail label="Name" value={board.name} />
          <Detail
            label="Description"
            value={board.description?.trim() || 'No description'}
          />
          <Detail
            label="Visibility"
            value={visibilityLabel(board.visibility)}
          />
          <Detail
            label="Workspace"
            value={
              workspace
                ? `${workspace.name}${workspace.type === WorkspaceType.PERSONAL ? ' (Personal)' : ''}`
                : directory.isPending
                  ? 'Checking…'
                  : 'Not one of your workspaces'
            }
          />
          <Detail label="Your role" value={roleLabel(board)} />
          <Detail
            label="Status"
            value={board.isArchived ? 'Archived · Read only' : 'Active'}
          />
        </View>
      </Surface>
      <Surface>
        <View style={{ gap: spacing.sm }}>
          <Text
            accessibilityRole="header"
            style={[typography.section, { color: c.text }]}
          >
            Sharing
          </Text>
          {board.currentUserRole ? (
            <Button
              label="Board members"
              variant="secondary"
              disabled={!ready || pending}
              onPress={() => router.push(`/boards/${boardId}/members`)}
            />
          ) : (
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              Only explicit Board members can view the member list. Workspace
              visibility provides read-only Board access.
            </Text>
          )}
        </View>
      </Surface>
      {(ownsActive || canRestore || sampleReview || sampleBlocked) && (
        <Surface>
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityRole="header"
              style={[typography.section, { color: c.text }]}
            >
              Manage board
            </Text>
            {ownsActive && (
              <Button
                label="Edit details and background"
                variant="secondary"
                disabled={!ready}
                onPress={() => setSheet('edit')}
              />
            )}
            {canChangeVisibility && (
              <Button
                label="Change visibility"
                variant="secondary"
                disabled={!ready}
                onPress={() => setSheet('visibility')}
              />
            )}
            {ownsActive && !canChangeVisibility && (
              <Text style={[typography.supporting, { color: c.textSecondary }]}>
                {policy.isError
                  ? 'Could not check workspace rules for visibility. Try again later.'
                  : policy.isPending
                    ? 'Checking workspace rules…'
                    : 'Workspace rules do not allow visibility changes.'}
              </Text>
            )}
            {ownsActive && (
              <Button
                label="Move to another workspace"
                variant="secondary"
                disabled={!ready}
                onPress={() => setSheet('move')}
              />
            )}
            {ownsActive && (
              <Button
                label="Archive board"
                variant="destructive"
                disabled={!ready}
                onPress={() => setSheet('archive')}
              />
            )}
            {canRestore && (
              <Button
                label="Restore board"
                disabled={!ready}
                onPress={() => setSheet('restore')}
              />
            )}
            {sampleReview && (
              <Button
                label="Remove sample board"
                variant="destructive"
                disabled={!ready || preview.isFetching}
                onPress={() => setSheet('sample')}
              />
            )}
            {sampleBlocked && (
              <Text style={[typography.supporting, { color: c.textSecondary }]}>
                Sample removal is unavailable for shared boards, boards with
                collaborative history, or boards moved out of their original
                Personal workspace.
              </Text>
            )}
          </View>
        </Surface>
      )}
      {!ownsActive && !canRestore && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Only the board owner can change these settings.
        </Text>
      )}
      {sheet === 'edit' && ownsActive && (
        <BoardEditor
          identity={identity}
          id={boardId}
          active={focused}
          onDismiss={() => setSheet(null)}
        />
      )}
      {sheet === 'visibility' && canChangeVisibility && (
        <VisibilitySheet
          board={board}
          pending={pending}
          error={error}
          disabled={!online || !retryReady}
          onSubmit={changeVisibility}
          onDismiss={() => {
            setError('');
            setSheet(null);
          }}
        />
      )}
      {sheet === 'move' && ownsActive && (
        <MoveSheet
          board={board}
          directory={directory}
          pending={pending}
          error={error}
          disabled={!online || !retryReady}
          onSubmit={move}
          onDismiss={() => {
            setError('');
            setSheet(null);
          }}
        />
      )}
      <ConfirmDialog
        visible={sheet === 'archive' && ownsActive}
        title={`Archive “${board.name}”?`}
        message="The board will move to Archived for every member and become read only. Its columns, cards and members are kept, and the owner can restore it later."
        confirmLabel="Archive board"
        destructive
        loading={pending}
        onConfirm={archive}
        onCancel={() => setSheet(null)}
      />
      <ConfirmDialog
        visible={sheet === 'restore' && canRestore}
        title={`Restore “${board.name}”?`}
        message="The board will return to Active with its columns, cards, comments and members. Archived cards remain archived."
        confirmLabel="Restore board"
        loading={pending}
        onConfirm={restore}
        onCancel={() => setSheet(null)}
      />
      {sheet === 'sample' && sampleHint && (
        <SampleRemovalSheet
          review={preview.data}
          reviewing={preview.isFetching}
          pending={pending}
          disabled={!online}
          onSubmit={removeSample}
          onDismiss={() => setSheet(null)}
        />
      )}
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[typography.caption, { color: c.textSecondary }]}>
        {label}
      </Text>
      <Text style={[typography.body, { color: c.text }]}>{value}</Text>
    </View>
  );
}

function SheetError({ message }: { message: string }) {
  const c = useTheme();
  return message ? (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: c.danger }]}
    >
      {message}
    </Text>
  ) : null;
}

function VisibilitySheet({
  board,
  pending,
  error,
  disabled,
  onSubmit,
  onDismiss,
}: {
  board: LifecycleBoard;
  pending: boolean;
  error: string;
  disabled: boolean;
  onSubmit: (value: BoardVisibility) => void;
  onDismiss: () => void;
}) {
  const c = useTheme();
  const [value, setValue] = useState<BoardVisibility>(board.visibility);
  const selected = visibilityOptions.find((option) => option.value === value)!;
  const widening =
    value === BoardVisibility.WORKSPACE_VISIBLE &&
    board.visibility === BoardVisibility.PRIVATE;
  const narrowing =
    value === BoardVisibility.PRIVATE &&
    board.visibility === BoardVisibility.WORKSPACE_VISIBLE;
  return (
    <BottomSheet
      visible
      title="Board visibility"
      onDismiss={onDismiss}
      dismissible={!pending}
      showHandle
      respectReducedMotion
    >
      <Text style={[typography.body, { color: c.textSecondary }]}>
        Choose who can see “{board.name}”.
      </Text>
      <SegmentedControl
        label="Board visibility"
        value={value}
        onChange={(next) => setValue(next as BoardVisibility)}
        options={visibilityOptions.map((option) => ({
          label: option.label,
          value: option.value,
          disabled: pending,
        }))}
      />
      <Text style={[typography.supporting, { color: c.textSecondary }]}>
        {selected.hint}
      </Text>
      {widening && (
        <Text style={[typography.supporting, { color: c.warning }]}>
          Everyone in this workspace will be able to read this board’s columns,
          cards and comments.
        </Text>
      )}
      {narrowing && (
        <Text style={[typography.supporting, { color: c.warning }]}>
          Workspace members who were not added to this board will lose their
          read-only access.
        </Text>
      )}
      <SheetError message={error} />
      <Button
        label={widening ? 'Share with workspace' : 'Save visibility'}
        loading={pending}
        disabled={disabled || value === board.visibility}
        onPress={() => onSubmit(value)}
      />
      <Button
        label="Cancel"
        variant="secondary"
        disabled={pending}
        onPress={onDismiss}
      />
    </BottomSheet>
  );
}

function MoveSheet({
  board,
  directory,
  pending,
  error,
  disabled,
  onSubmit,
  onDismiss,
}: {
  board: LifecycleBoard;
  directory: {
    data?: readonly WorkspaceSummary[];
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
  };
  pending: boolean;
  error: string;
  disabled: boolean;
  onSubmit: (destination: string) => void;
  onDismiss: () => void;
}) {
  const c = useTheme();
  const [target, setTarget] = useState('');
  // Destinations come from the joined directory and its server capability only.
  const destinations = (directory.data ?? []).filter(
    (row) => row.id !== board.workspaceId && row.canCreateBoards,
  );
  const chosen = destinations.find((row) => row.id === target);
  const source = directory.data?.find((row) => row.id === board.workspaceId);
  return (
    <BottomSheet
      visible
      title="Move board"
      onDismiss={onDismiss}
      dismissible={!pending}
      showHandle
      respectReducedMotion
    >
      <Text style={[typography.body, { color: c.textSecondary }]}>
        Move “{board.name}” to another workspace.
      </Text>
      {directory.isPending && (
        <Skeleton height={44} label="Loading your workspaces" />
      )}
      {directory.isError && (
        <Text style={[typography.body, { color: c.danger }]}>
          Could not load your joined workspaces. Close and try again.
        </Text>
      )}
      {directory.isSuccess && !destinations.length && (
        <Text style={[typography.body, { color: c.textSecondary }]}>
          No other workspace allows you to add boards.
        </Text>
      )}
      {destinations.length > 0 && (
        <SegmentedControl
          label="Destination workspace"
          value={target}
          onChange={setTarget}
          options={destinations.map((row) => ({
            value: row.id,
            label: `${row.name}${row.type === WorkspaceType.PERSONAL ? ' (Personal)' : ''}`,
            disabled: pending,
          }))}
        />
      )}
      <View style={{ gap: spacing.xs }}>
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          • The board link stays the same.
        </Text>
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          • People added to the board keep their access.
        </Text>
        <Text style={[typography.supporting, { color: c.warning }]}>
          • The board will become Private in the destination.
          {board.visibility === BoardVisibility.WORKSPACE_VISIBLE
            ? ` Members of ${source?.name ?? 'the current workspace'} who relied on workspace visibility will lose access.`
            : ''}
        </Text>
      </View>
      <SheetError message={error} />
      <Button
        label={chosen ? `Move to ${chosen.name}` : 'Choose a workspace'}
        loading={pending}
        disabled={disabled || !chosen}
        onPress={() => chosen && onSubmit(chosen.id)}
      />
      <Button
        label="Cancel"
        variant="secondary"
        disabled={pending}
        onPress={onDismiss}
      />
    </BottomSheet>
  );
}

function SampleRemovalSheet({
  review,
  reviewing,
  pending,
  disabled,
  onSubmit,
  onDismiss,
}: {
  review: StarterBoardRemovalPreview | undefined;
  reviewing: boolean;
  pending: boolean;
  disabled: boolean;
  onSubmit: (
    review: StarterBoardRemovalPreview,
    confirmation: string,
    onRejected: (message: string) => void,
  ) => void;
  onDismiss: () => void;
}) {
  const c = useTheme();
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  // A fresh server review always requires the phrase to be typed again.
  const version = review?.version;
  useEffect(() => setConfirmation(''), [version]);
  return (
    <BottomSheet
      visible
      title="Remove sample board"
      onDismiss={onDismiss}
      dismissible={!pending}
      showHandle
      respectReducedMotion
    >
      <Text style={[typography.body, { color: c.textSecondary }]}>
        Permanently remove this sample board and all of its columns, cards,
        labels, checklists, comments and attachments. This cannot be undone.
      </Text>
      {(!review || reviewing) && (
        <Skeleton height={44} label="Checking sample board" />
      )}
      {review && !reviewing && (
        <>
          <Text style={[typography.strong, { color: c.text }]}>
            {review.boardName}
          </Text>
          {review.isCustomized && (
            <Text style={[typography.body, { color: c.danger }]}>
              This board has been changed since it was created. Removing it will
              permanently delete your customized work and any content you added.
            </Text>
          )}
          <TextField
            label={`Type ${review.confirmation} to confirm`}
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            editable={!pending}
          />
        </>
      )}
      <SheetError message={message} />
      <Button
        label="Remove sample board"
        variant="destructive"
        loading={pending}
        disabled={
          disabled ||
          !review ||
          reviewing ||
          confirmation !== review.confirmation
        }
        onPress={() => {
          if (!review) return;
          setMessage('');
          onSubmit(review, confirmation, (text) => {
            setConfirmation('');
            setMessage(text);
          });
        }}
      />
      <Button
        label="Cancel"
        variant="secondary"
        disabled={pending}
        onPress={onDismiss}
      />
    </BottomSheet>
  );
}
