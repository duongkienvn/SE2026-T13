import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import { ApiError } from '../../infrastructure/api/errors';
import { sameIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { TabHeader } from '../../navigation/scaffold';
import { destinationPath, type ResourceId } from '../../navigation/routes';
import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  Surface,
  sizes,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { useSelectedWorkspace } from './WorkspaceSelection';
import {
  WorkspaceBoards,
  defaultBoardFilters,
  type BoardFilters,
} from './WorkspaceBoards';
import { WorkspaceSelector } from './WorkspaceSelector';
import { StarredBoards } from '../boards/StarredBoards';
import { BoardForm } from '../boards/BoardForm';
import { createBoardApi } from '../boards/api';
import { WorkspaceForm } from './WorkspaceForm';
import { createWorkspaceApi } from './api';
import { workspaceDirectoryOptions, workspaceOverviewOptions } from './queries';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from './status';

export function BoardsScreen() {
  const session = useSessionSnapshot();
  return session.status === 'authenticated' ? (
    <VerifiedBoards key={session.generation} />
  ) : null;
}

function VerifiedBoards() {
  const data = useMobileData();
  const c = useTheme();
  const router = useRouter();
  const active = useIsFocused();
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    activeRef.current = active;
    return () => {
      activeRef.current = false;
    };
  }, [active]);
  const online = useWorkspaceOnline();
  const [picker, setPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [boardFilters, setBoardFilters] = useState<
    Record<string, BoardFilters>
  >({});
  const lastRefresh = useRef(-Infinity);
  const {
    directory,
    identity,
    selected,
    selectedId,
    setSelectedId,
    isCurrentSelection,
    workspaces,
  } = useSelectedWorkspace(active);
  // Keep the duplicate-submission fence in session-scoped memory even if this
  // screen unmounts while a create response is uncertain.
  const createFenceKey = [
    ...queryKeys.scope(identity),
    'workspace-create-fence',
  ] as const;
  const [createBlocked, setCreateBlocked] = useState(
    () => data.queryClient.getQueryData<boolean>(createFenceKey) === true,
  );
  const createdId = useRef<ResourceId | null>(null);
  const creationOrigin = useRef<ResourceId | null>(null);
  function fenceCreate(blocked: boolean) {
    data.assertCurrent(identity);
    data.queryClient.setQueryDefaults(createFenceKey, { gcTime: Infinity });
    data.queryClient.setQueryData(createFenceKey, blocked);
    setCreateBlocked(blocked);
  }
  const retryReady = useWorkspaceRetryReady(
    directory.error,
    directory.errorUpdatedAt,
  );
  useEffect(() => {
    if (!active || !selectedId) setPicker(false);
  }, [active, selectedId]);

  async function selectCreated(id: ResourceId) {
    data.assertCurrent(identity);
    const directoryKey = queryKeys.workspaces(identity);
    data.cancelResourceRequests(directoryKey);
    await data.queryClient.cancelQueries({ queryKey: directoryKey });
    data.assertCurrent(identity);
    data.resources.bumpKey(directoryKey);
    await data.queryClient.fetchQuery({
      ...workspaceDirectoryOptions(data, identity),
      staleTime: 0,
    });
    data.assertCurrent(identity);
    if (
      !activeRef.current ||
      (creationOrigin.current && !isCurrentSelection(creationOrigin.current))
    )
      throw new Error('selection changed');
    if (!setSelectedId(id)) throw new Error('selection unavailable');
    createdId.current = null;
    fenceCreate(false);
    setCreating(false);
    router.navigate(destinationPath({ kind: 'workspace', workspaceId: id }));
  }

  async function refresh() {
    const now = Date.now();
    if (
      !active ||
      !online ||
      refreshing ||
      (now - lastRefresh.current < 800 && !directory.isError) ||
      !sameIdentity(identity, data.getIdentity()) ||
      data.queryClient.isFetching({
        queryKey: queryKeys.workspaces(identity),
      }) ||
      !canRetryWorkspace(directory.error, directory.errorUpdatedAt)
    )
      return;
    lastRefresh.current = now;
    setRefreshing(true);
    try {
      const latest = await directory.refetch({ cancelRefetch: false });
      if (!latest.isSuccess || !selectedId || !isCurrentSelection(selectedId))
        return;
      const boardKey = queryKeys.workspaceBoards(identity, selectedId);
      const overviewKey = workspaceOverviewOptions(
        data,
        identity,
        selectedId,
      ).queryKey;
      await data.invalidate(identity, [boardKey, overviewKey]);
    } catch {
      // Query errors render in their owning section; session changes end the scope.
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.background }}
      edges={['top', 'left', 'right']}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={c.primary}
            colors={[c.focus]}
            progressBackgroundColor={c.surface}
          />
        }
      >
        <TabHeader search />
        <View style={{ gap: spacing.xs }}>
          <Text
            accessibilityRole="header"
            style={[typography.display, { color: c.text }]}
          >
            Boards
          </Text>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            All your boards, across workspaces.
          </Text>
        </View>
        {(!online || directory.isPaused) && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.textSecondary }]}
          >
            {selected
              ? 'Offline. Showing available workspace data.'
              : 'You’re offline. Reconnect to load workspaces.'}
          </Text>
        )}
        {directory.isPending && online && !directory.isPaused && (
          <Surface>
            <Skeleton height={48} label="Loading workspaces" />
          </Surface>
        )}
        {directory.isError && online && (
          <Surface>
            <ErrorState
              title="Workspaces unavailable"
              description={workspaceErrorMessage(directory.error)}
              action={
                <Button
                  label="Retry workspaces"
                  variant="secondary"
                  disabled={
                    !active || refreshing || directory.isFetching || !retryReady
                  }
                  onPress={() => void refresh()}
                />
              }
            />
          </Surface>
        )}
        {directory.isSuccess && !selected && (
          <Surface>
            <EmptyState title="No workspaces available" />
            <Button
              label="Create new workspace"
              variant="secondary"
              disabled={!active || !online}
              onPress={() => {
                if (
                  !activeRef.current ||
                  !sameIdentity(identity, data.getIdentity())
                )
                  return;
                creationOrigin.current = null;
                setCreating(true);
              }}
            />
          </Surface>
        )}
        {selected && (
          <SelectedWorkspace
            key={selected.id}
            selected={selected}
            identity={identity}
            active={active}
            picker={picker}
            setPicker={setPicker}
            onCreate={() => {
              setPicker(false);
              creationOrigin.current = selectedId;
              setCreating(true);
            }}
            workspaces={workspaces ?? []}
            isCurrentSelection={isCurrentSelection}
            select={(id) => {
              if (setSelectedId(id)) setPicker(false);
            }}
            navigate={router.navigate}
            filters={boardFilters[selected.id] ?? defaultBoardFilters}
            onFiltersChange={(filters) =>
              setBoardFilters((previous) => ({
                ...previous,
                [selected.id]: filters,
              }))
            }
          />
        )}
        {creating && (
          <WorkspaceForm
            blocked={createBlocked}
            onConfirmChecked={() => fenceCreate(false)}
            onRetryLookup={
              createdId.current
                ? () => selectCreated(createdId.current!)
                : undefined
            }
            onDismiss={() => setCreating(false)}
            onSubmit={async (input) => {
              if (
                !activeRef.current ||
                !sameIdentity(identity, data.getIdentity()) ||
                (selectedId && !isCurrentSelection(selectedId))
              )
                throw new Error(
                  'Workspace access changed. Close this form and try again.',
                );
              const api = createWorkspaceApi(data.api, identity);
              if (input.name === undefined) return;
              let committed = false;
              try {
                fenceCreate(true);
                const created = await api.create(
                  { ...input, name: input.name },
                  new AbortController().signal,
                );
                committed = true;
                createdId.current = created.id;
                void data
                  .invalidate(identity, [queryKeys.home(identity)])
                  .catch(() => undefined);
                await selectCreated(created.id);
              } catch (error) {
                if (!sameIdentity(identity, data.getIdentity())) return;
                if (
                  committed ||
                  !(error instanceof ApiError) ||
                  error.status >= 500 ||
                  [
                    'timeout',
                    'network',
                    'aborted',
                    'invalid-response',
                  ].includes(error.kind)
                ) {
                  fenceCreate(true);
                  void data
                    .invalidate(identity, [queryKeys.workspaces(identity)])
                    .catch(() => undefined);
                  throw new Error(
                    'The result could not be confirmed. Close this form and check your workspace list before trying again.',
                    { cause: error },
                  );
                }
                fenceCreate(false);
                throw new Error(workspaceErrorMessage(error), { cause: error });
              }
            }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SelectedWorkspace({
  selected,
  identity,
  active,
  picker,
  setPicker,
  onCreate,
  workspaces,
  select,
  isCurrentSelection,
  navigate,
  filters,
  onFiltersChange,
}: {
  selected: NonNullable<ReturnType<typeof useSelectedWorkspace>['selected']>;
  identity: ReturnType<typeof useSelectedWorkspace>['identity'];
  active: boolean;
  picker: boolean;
  setPicker: (value: boolean) => void;
  onCreate: () => void;
  workspaces: NonNullable<
    ReturnType<typeof useSelectedWorkspace>['workspaces']
  >;
  select: (id: string) => void;
  isCurrentSelection: ReturnType<
    typeof useSelectedWorkspace
  >['isCurrentSelection'];
  navigate: (path: ReturnType<typeof destinationPath>) => void;
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
}) {
  const data = useMobileData();
  const options = workspaceOverviewOptions(data, identity, selected.id);
  const overview = useQuery({ ...options, enabled: active });
  const safe = () => active && isCurrentSelection(selected.id);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const fenceKey = [
    ...queryKeys.scope(identity),
    'board-create-fence',
  ] as const;
  const [boardBlocked, setBoardBlocked] = useState(
    () => data.queryClient.getQueryData<boolean>(fenceKey) === true,
  );
  const fence = (value: boolean) => {
    data.assertCurrent(identity);
    data.queryClient.setQueryDefaults(fenceKey, { gcTime: Infinity });
    data.queryClient.setQueryData(fenceKey, value);
    setBoardBlocked(value);
  };
  return (
    <>
      <WorkspaceSelector
        selected={selected}
        workspaces={workspaces}
        memberCount={overview.data?.memberCount}
        open={picker}
        onOpen={() => {
          if (safe()) setPicker(true);
        }}
        onDismiss={() => setPicker(false)}
        onSelect={select}
        onCreate={() => {
          if (safe()) onCreate();
        }}
      />
      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          label="Workspace overview"
          variant="link"
          onPress={() => {
            if (safe())
              navigate(
                destinationPath({
                  kind: 'workspace',
                  workspaceId: selected.id,
                }),
              );
          }}
        />
      </View>
      <StarredBoards
        identity={identity}
        workspace={selected.id}
        active={active}
        onBoard={(id) => {
          if (safe()) navigate(destinationPath({ kind: 'board', boardId: id }));
        }}
      />
      <WorkspaceBoards
        identity={identity}
        workspace={selected.id}
        active={active}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onCreateBoard={
          selected.canCreateBoards
            ? () => {
                if (safe()) setCreatingBoard(true);
              }
            : undefined
        }
        onBoard={(id) => {
          if (safe()) navigate(destinationPath({ kind: 'board', boardId: id }));
        }}
      />
      {creatingBoard && (
        <BoardForm
          identity={identity}
          selected={selected}
          workspaces={workspaces}
          blocked={boardBlocked}
          onConfirmChecked={() => fence(false)}
          onDismiss={() => setCreatingBoard(false)}
          onSubmit={async (input) => {
            if (
              !safe() ||
              !sameIdentity(identity, data.getIdentity()) ||
              !workspaces.some(
                (workspace) =>
                  workspace.id === input.workspaceId &&
                  workspace.canCreateBoards,
              )
            )
              throw new Error(
                'Workspace access changed. Close this form and try again.',
              );
            let confirmed = false;
            try {
              fence(true);
              const created = await createBoardApi(data.api, identity).create(
                input,
                new AbortController().signal,
              );
              confirmed = true;
              if (
                created.workspaceId !== input.workspaceId ||
                created.visibility !== 'PRIVATE'
              )
                throw new Error('Unexpected board response');
              data.assertCurrent(identity);
              fence(false);
              void data
                .invalidate(identity, [
                  queryKeys.workspaceBoards(identity, input.workspaceId),
                  queryKeys.home(identity),
                ])
                .catch(() => undefined);
              setCreatingBoard(false);
            } catch (error) {
              if (!sameIdentity(identity, data.getIdentity())) return;
              if (
                confirmed ||
                !(error instanceof ApiError) ||
                error.status >= 500 ||
                ['timeout', 'network', 'aborted', 'invalid-response'].includes(
                  error.kind,
                )
              ) {
                void data
                  .invalidate(identity, [
                    queryKeys.workspaceBoards(identity, input.workspaceId),
                  ])
                  .catch(() => undefined);
                throw new Error(
                  'The result could not be confirmed. Check the board list before trying again.',
                  { cause: error },
                );
              }
              fence(false);
              throw new Error(workspaceErrorMessage(error), { cause: error });
            }
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    width: '100%',
    maxWidth: sizes.contentMax,
    alignSelf: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
});
