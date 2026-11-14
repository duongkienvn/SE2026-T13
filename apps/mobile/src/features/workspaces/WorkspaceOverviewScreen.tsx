import { useIsFocused, usePathname, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { WorkspaceType } from '@kanban/shared';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { ResourceBoundary } from '../../navigation/resource-boundary';
import {
  destinationPath,
  parsePath,
  type ResourceId,
} from '../../navigation/routes';
import { useSession } from '../../navigation/session-context';
import {
  Button,
  Dialog,
  TextField,
  ErrorState,
  LoadingState,
  ListRow,
  Surface,
  radius,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { workspaceId } from './decoder';
import {
  isWorkspaceDenied,
  evictWorkspace,
  workspaceDetailOptions,
  workspaceOverviewOptions,
} from './queries';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from './status';
import { WorkspaceIcon, workspaceMetadata } from './WorkspaceSelector';
import { BoardArtwork } from '../home/BoardArtwork';
import { createWorkspaceApi } from './api';
import { WorkspaceForm, type WorkspaceDraft } from './WorkspaceForm';
import { WorkspaceGlyph } from './WorkspaceGlyph';
import { queryKeys } from '../../infrastructure/query/keys';
import { sameIdentity } from '../../infrastructure/api/session-client';
import { ApiError } from '../../infrastructure/api/errors';

export function WorkspaceOverviewScreen() {
  const pathname = usePathname();
  const destination = parsePath(pathname);
  const id =
    destination?.kind === 'workspace'
      ? workspaceId(destination.workspaceId)
      : null;
  const session = useSessionSnapshot();
  if (!id || session.status !== 'authenticated')
    return <ResourceBoundary access="unavailable" />;
  return (
    <VerifiedOverview
      key={`${session.generation}:${id}`}
      id={id}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}

function VerifiedOverview({
  id,
  identity,
}: {
  id: ResourceId;
  identity: SessionIdentity;
}) {
  const data = useMobileData();
  const router = useRouter();
  const session = useSession();
  const c = useTheme();
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
  const [editing, setEditing] = useState(false);
  const draft = useRef<WorkspaceDraft | undefined>(undefined);
  const [action, setAction] = useState<'leave' | 'delete' | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionFailure, setActionFailure] = useState<{
    error: ApiError;
    at: number;
  } | null>(null);
  const actionRetryReady = useWorkspaceRetryReady(
    actionFailure?.error,
    actionFailure?.at ?? 0,
  );
  const [pending, setPending] = useState(false);
  const [verification, setVerification] = useState<
    'idle' | 'failed' | 'checking'
  >('idle');
  const busy = useRef(false);
  const detailOptions = workspaceDetailOptions(data, identity, id);
  const readable = data.resources.readable(detailOptions.queryKey);
  const detail = useQuery({
    ...detailOptions,
    enabled: active && readable,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  useEffect(() => {
    if (detail.data && !detail.data.canManage) {
      draft.current = undefined;
      setEditing(false);
      setAction((value) => (value === 'delete' ? null : value));
    }
  }, [detail.data]);
  const confirmed = detail.isFetchedAfterMount && detail.isSuccess;
  const overviewOptions = workspaceOverviewOptions(data, identity, id);
  const overview = useQuery({
    ...overviewOptions,
    enabled: active && confirmed && readable,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  useEffect(() => {
    if (
      !readable ||
      isWorkspaceDenied(detail.error) ||
      isWorkspaceDenied(overview.error)
    )
      draft.current = undefined;
  }, [readable, detail.error, overview.error]);
  const detailRetryReady = useWorkspaceRetryReady(
    detail.error,
    detail.errorUpdatedAt,
  );
  const overviewRetryReady = useWorkspaceRetryReady(
    overview.error,
    overview.errorUpdatedAt,
  );
  if (
    !readable ||
    isWorkspaceDenied(detail.error) ||
    isWorkspaceDenied(overview.error)
  )
    return <ResourceBoundary access="unavailable" />;
  if (verification !== 'idle') {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.background }}
        edges={['left', 'right', 'bottom']}
      >
        <ErrorState
          title="Verify workspace access"
          description="The action could not be confirmed. Reconnect and check access before continuing."
          action={
            <Button
              label="Check access"
              variant="secondary"
              loading={verification === 'checking'}
              disabled={!active || !online || !detailRetryReady}
              onPress={() => {
                if (
                  !active ||
                  !online ||
                  verification === 'checking' ||
                  !canRetryWorkspace(detail.error, detail.errorUpdatedAt)
                )
                  return;
                setVerification('checking');
                void detail
                  .refetch({ cancelRefetch: false })
                  .then((result) => {
                    if (sameIdentity(identity, data.getIdentity()))
                      setVerification(result.isSuccess ? 'idle' : 'failed');
                  })
                  .catch(() => {
                    if (sameIdentity(identity, data.getIdentity()))
                      setVerification('failed');
                  });
              }}
            />
          }
        />
      </SafeAreaView>
    );
  }
  if (!confirmed || !detail.data || session.status !== 'authenticated') {
    if (!online || detail.isPaused || detail.isError) {
      return (
        <SafeAreaView
          style={{ flex: 1, backgroundColor: c.background }}
          edges={['left', 'right', 'bottom']}
        >
          <ErrorState
            title={
              !online || detail.isPaused
                ? 'Connection unavailable'
                : 'Workspace unavailable'
            }
            description={
              !online || detail.isPaused
                ? 'Reconnect to verify workspace access.'
                : workspaceErrorMessage(detail.error)
            }
            action={
              online && !detail.isPaused ? (
                <Button
                  label="Retry"
                  variant="secondary"
                  disabled={!active || detail.isFetching || !detailRetryReady}
                  onPress={() => {
                    if (
                      active &&
                      online &&
                      canRetryWorkspace(detail.error, detail.errorUpdatedAt)
                    )
                      void detail.refetch({ cancelRefetch: false });
                  }}
                />
              ) : undefined
            }
          />
        </SafeAreaView>
      );
    }
    return <ResourceBoundary access="checking" />;
  }
  const workspace = detail.data;
  const api = createWorkspaceApi(data.api, identity);
  const team = workspace.type === WorkspaceType.TEAM;
  const mayAttemptDelete =
    team &&
    workspace.canManage &&
    overview.isSuccess &&
    !overview.isFetching &&
    overview.data.visibleBoardCount === 0;
  async function lifecycle(kind: 'leave' | 'delete') {
    if (
      busy.current ||
      !active ||
      !online ||
      !canRetryWorkspace(actionFailure?.error, actionFailure?.at ?? 0) ||
      !data.resources.readable(detailOptions.queryKey)
    )
      return;
    if (
      kind === 'delete' &&
      (!mayAttemptDelete || confirmation !== workspace.name)
    )
      return;
    if (kind === 'leave' && !team) return;
    busy.current = true;
    setPending(true);
    setActionError('');
    setActionFailure(null);
    try {
      if (kind === 'leave') await api.leave(id, new AbortController().signal);
      else await api.remove(id, confirmation, new AbortController().signal);
      data.assertCurrent(identity);
      evictWorkspace(data, identity, id);
      setAction(null);
      if (activeRef.current)
        router.navigate(destinationPath({ kind: 'tab', tab: 'boards' }));
    } catch (error) {
      if (sameIdentity(identity, data.getIdentity())) {
        if (error instanceof ApiError && error.status === 404) {
          evictWorkspace(data, identity, id);
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setAction(null);
          setVerification('failed');
          return;
        }
        if (
          !(error instanceof ApiError) ||
          error.status >= 500 ||
          ['timeout', 'network', 'aborted', 'invalid-response'].includes(
            error.kind,
          )
        ) {
          setAction(null);
          setVerification('failed');
          return;
        }
        if (error instanceof ApiError)
          setActionFailure({ error, at: Date.now() });
        setActionError(
          error instanceof ApiError && error.status === 409
            ? error.message
            : workspaceErrorMessage(error),
        );
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <ResourceBoundary
      access={{
        status: 'allowed',
        sessionKey: session.sessionKey,
        resourcePath: destinationPath({ kind: 'workspace', workspaceId: id }),
      }}
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.background }}
        edges={['left', 'right', 'bottom']}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
        >
          <View style={{ gap: spacing.xs }}>
            {workspace.icon ? (
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.control,
                  backgroundColor: c.surfaceSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <WorkspaceGlyph icon={workspace.icon} />
              </View>
            ) : (
              <WorkspaceIcon type={workspace.type} />
            )}
            <Text
              accessibilityRole="header"
              style={[typography.display, { color: c.text }]}
            >
              {workspace.name}
            </Text>
            <Text style={[typography.body, { color: c.textSecondary }]}>
              {workspaceMetadata(workspace, overview.data?.memberCount)}
            </Text>
          </View>
          {workspace.description ? (
            <Text style={[typography.body, { color: c.text }]}>
              {workspace.description}
            </Text>
          ) : null}
          {workspace.canManage && (
            <Button
              label="Edit workspace"
              variant="secondary"
              disabled={!active || !online}
              onPress={() => setEditing(true)}
            />
          )}
          {overview.data && (
            <Surface>
              <Text style={[typography.strong, { color: c.text }]}>
                {overview.data.visibleBoardCount} visible boards
              </Text>
              <Text style={[typography.supporting, { color: c.textSecondary }]}>
                {overview.data.activeBoardCount} active ·{' '}
                {overview.data.archivedBoardCount} archived
              </Text>
            </Surface>
          )}
          {overview.data && (
            <View style={{ gap: spacing.md }}>
              <Text
                accessibilityRole="header"
                style={[typography.section, { color: c.text }]}
              >
                Recent boards
              </Text>
              {overview.data.recentBoards.length === 0 ? (
                <Text style={[typography.body, { color: c.textSecondary }]}>
                  No recent boards
                </Text>
              ) : (
                overview.data.recentBoards.map((board) => (
                  <Surface key={board.id}>
                    <ListRow
                      title={board.name}
                      subtitle={
                        board.isArchived ? 'Archived · Read only' : undefined
                      }
                      accessibilityLabel={`Open board ${board.name}${board.isArchived ? ', archived, read only' : ''}`}
                      leading={<BoardArtwork preset={board.backgroundPreset} />}
                      disabled={!active || !online}
                      onPress={() => {
                        if (
                          active &&
                          online &&
                          data.resources.readable(detailOptions.queryKey) &&
                          data.queryClient.getQueryData(
                            overviewOptions.queryKey,
                          ) === overview.data
                        )
                          router.navigate(
                            destinationPath({
                              kind: 'board',
                              boardId: board.id,
                            }),
                          );
                      }}
                    />
                  </Surface>
                ))
              )}
            </View>
          )}
          {overview.isPending && !overview.isPaused && (
            <LoadingState label="Loading workspace summary" />
          )}
          {overview.isError && online && (
            <ErrorState
              title="Summary unavailable"
              description={workspaceErrorMessage(overview.error)}
              action={
                <Button
                  label="Retry summary"
                  variant="secondary"
                  disabled={
                    !active || overview.isFetching || !overviewRetryReady
                  }
                  onPress={() => {
                    if (
                      active &&
                      online &&
                      canRetryWorkspace(overview.error, overview.errorUpdatedAt)
                    )
                      void overview.refetch({ cancelRefetch: false });
                  }}
                />
              }
            />
          )}
          {(!online || overview.isPaused) && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.textSecondary }]}
            >
              Offline. Some workspace details may be out of date.
            </Text>
          )}
          {team && (
            <Button
              label="Leave workspace"
              variant="secondary"
              disabled={!active || !online}
              onPress={() => {
                setActionError('');
                setAction('leave');
              }}
            />
          )}
          {team &&
            workspace.canManage &&
            overview.isSuccess &&
            !overview.isFetching &&
            overview.data.visibleBoardCount > 0 && (
              <Text style={[typography.body, { color: c.textSecondary }]}>
                This workspace must have no boards before it can be deleted,
                including archived boards.
              </Text>
            )}
          {mayAttemptDelete && (
            <Button
              label="Delete workspace"
              variant="destructive"
              disabled={!active || !online}
              onPress={() => {
                setConfirmation('');
                setActionError('');
                setAction('delete');
              }}
            />
          )}
        </ScrollView>
        {editing && workspace.canManage && (
          <WorkspaceForm
            workspace={workspace}
            draft={draft.current}
            onDraftChange={(value) => {
              draft.current = value;
            }}
            onDismiss={() => {
              draft.current = undefined;
              setEditing(false);
            }}
            onSubmit={async (input) => {
              if (
                !active ||
                !online ||
                !data.resources.readable(detailOptions.queryKey)
              )
                throw new Error(
                  'Workspace access or connection changed. Reopen the form to retry.',
                );
              const changes = {
                ...(input.name !== undefined && input.name !== workspace.name
                  ? { name: input.name }
                  : {}),
                ...(input.description !== undefined &&
                input.description !== workspace.description
                  ? { description: input.description }
                  : {}),
                ...(input.icon !== undefined && input.icon !== workspace.icon
                  ? { icon: input.icon }
                  : {}),
              };
              if (!Object.keys(changes).length) {
                draft.current = undefined;
                setEditing(false);
                return;
              }
              try {
                await api.update(id, changes, new AbortController().signal);
                data.assertCurrent(identity);
                draft.current = undefined;
                void data
                  .invalidate(identity, [
                    queryKeys.workspace(identity, id),
                    queryKeys.workspaces(identity),
                    queryKeys.home(identity),
                  ])
                  .catch(() => undefined);
                setEditing(false);
              } catch (error) {
                if (!sameIdentity(identity, data.getIdentity())) return;
                if (error instanceof ApiError && error.status === 404) {
                  draft.current = undefined;
                  evictWorkspace(data, identity, id);
                  return;
                }
                if (error instanceof ApiError && error.status === 403) {
                  setEditing(false);
                  setVerification('failed');
                  return;
                }
                throw new Error(workspaceErrorMessage(error), { cause: error });
              }
            }}
          />
        )}
        <Dialog
          visible={action === 'leave' && team}
          title="Leave workspace?"
          onDismiss={() => {
            if (!pending) setAction(null);
          }}
          dismissible={!pending}
        >
          <Text style={[typography.body, { color: c.textSecondary }]}>
            You will leave this Team Workspace. Explicit board access may
            remain.
          </Text>
          {!!actionError && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.danger }]}
            >
              {actionError}
            </Text>
          )}
          <Button
            label="Leave workspace"
            variant="destructive"
            loading={pending}
            disabled={!actionRetryReady}
            onPress={() => void lifecycle('leave')}
          />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={pending}
            onPress={() => setAction(null)}
          />
        </Dialog>
        <Dialog
          visible={action === 'delete' && mayAttemptDelete}
          title="Delete workspace?"
          onDismiss={() => {
            if (!pending) setAction(null);
          }}
          dismissible={!pending}
        >
          <Text style={[typography.body, { color: c.textSecondary }]}>
            This permanently deletes the empty Team Workspace. Enter its exact
            name to confirm.
          </Text>
          <TextField
            label="Workspace name"
            value={confirmation}
            onChangeText={setConfirmation}
            editable={!pending}
          />
          {!!actionError && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.danger }]}
            >
              {actionError}
            </Text>
          )}
          <Button
            label="Delete workspace"
            variant="destructive"
            loading={pending}
            disabled={confirmation !== workspace.name || !actionRetryReady}
            onPress={() => void lifecycle('delete')}
          />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={pending}
            onPress={() => setAction(null)}
          />
        </Dialog>
      </SafeAreaView>
    </ResourceBoundary>
  );
}
