import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { sameIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { TabHeader } from '../../navigation/scaffold';
import { destinationPath } from '../../navigation/routes';
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
import { WorkspaceBoards } from './WorkspaceBoards';
import { WorkspaceSelector } from './WorkspaceSelector';
import { workspaceBoardOptions, workspaceOverviewOptions } from './queries';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
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
  const online = useWorkspaceOnline();
  const [picker, setPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const {
    directory,
    identity,
    selected,
    selectedId,
    setSelectedId,
    workspaces,
  } = useSelectedWorkspace(active);
  useEffect(() => {
    if (!active || !selectedId) setPicker(false);
  }, [active, selectedId]);

  async function refresh() {
    if (
      !active ||
      !online ||
      refreshing ||
      !sameIdentity(identity, data.getIdentity()) ||
      data.queryClient.isFetching({
        queryKey: queryKeys.workspaces(identity),
      }) ||
      !canRetryWorkspace(directory.error, directory.errorUpdatedAt)
    )
      return;
    setRefreshing(true);
    try {
      const latest = await directory.refetch({ cancelRefetch: false });
      if (
        !latest.isSuccess ||
        !selectedId ||
        !latest.data.some((row) => row.id === selectedId) ||
        !sameIdentity(identity, data.getIdentity())
      )
        return;
      const boardKey = workspaceBoardOptions(
        data,
        identity,
        selectedId,
      ).queryKey;
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
                  disabled={directory.isFetching}
                  onPress={() => void refresh()}
                />
              }
            />
          </Surface>
        )}
        {directory.isSuccess && !selected && (
          <Surface>
            <EmptyState title="No workspaces available" />
          </Surface>
        )}
        {selected && (
          <SelectedWorkspace
            key={selected.id}
            selected={selected}
            identity={identity}
            active={active && !picker}
            overviewActive={active}
            picker={picker}
            setPicker={setPicker}
            workspaces={workspaces ?? []}
            select={(id) => {
              if (setSelectedId(id)) setPicker(false);
            }}
            navigate={router.navigate}
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
  overviewActive,
  picker,
  setPicker,
  workspaces,
  select,
  navigate,
}: {
  selected: NonNullable<ReturnType<typeof useSelectedWorkspace>['selected']>;
  identity: ReturnType<typeof useSelectedWorkspace>['identity'];
  active: boolean;
  overviewActive: boolean;
  picker: boolean;
  setPicker: (value: boolean) => void;
  workspaces: NonNullable<
    ReturnType<typeof useSelectedWorkspace>['workspaces']
  >;
  select: (id: string) => void;
  navigate: (path: ReturnType<typeof destinationPath>) => void;
}) {
  const data = useMobileData();
  const options = workspaceOverviewOptions(data, identity, selected.id);
  const overview = useQuery({ ...options, enabled: overviewActive });
  const directory = queryKeys.workspaces(identity, { limit: 20 });
  const safe = () =>
    sameIdentity(identity, data.getIdentity()) &&
    data.resources.readable(queryKeys.workspace(identity, selected.id)) &&
    data.queryClient
      .getQueryData<typeof workspaces>(directory)
      ?.some((row) => row.id === selected.id);
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
      <WorkspaceBoards
        identity={identity}
        workspace={selected.id}
        active={active || picker}
        onBoard={(id) => {
          if (safe()) navigate(destinationPath({ kind: 'board', boardId: id }));
        }}
      />
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
