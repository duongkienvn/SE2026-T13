import { useIsFocused, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
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
  ErrorState,
  LoadingState,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { workspaceId } from './decoder';
import {
  isWorkspaceDenied,
  workspaceDetailOptions,
  workspaceOverviewOptions,
} from './queries';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from './status';
import { workspaceMetadata } from './WorkspaceSelector';

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
  const session = useSession();
  const c = useTheme();
  const active = useIsFocused();
  const online = useWorkspaceOnline();
  const detailOptions = workspaceDetailOptions(data, identity, id);
  const readable = data.resources.readable(detailOptions.queryKey);
  const detail = useQuery({
    ...detailOptions,
    enabled: active && readable,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const confirmed = detail.isFetchedAfterMount && detail.isSuccess;
  const overview = useQuery({
    ...workspaceOverviewOptions(data, identity, id),
    enabled: active && confirmed && readable,
  });
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
        </ScrollView>
      </SafeAreaView>
    </ResourceBoundary>
  );
}
