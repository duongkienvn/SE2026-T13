import { useQuery } from '@tanstack/react-query';
import { Stack, useIsFocused, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import {
  useBoardRealtime,
  useRealtime,
} from '../../infrastructure/realtime/RealtimeProvider';
import { ResourceBoundary } from '../../navigation/resource-boundary';
import type { ResourceId } from '../../navigation/routes';
import { Button, ErrorState, useTheme } from '../../ui';
import { datePreferencesOptions } from '../cards/metadata/queries';
import { isWorkspaceDenied } from '../workspaces/queries';
import { useWorkspaceOnline } from '../workspaces/status';
import { activityCardId, boardAction } from './board/decoder';
import { activityKeys } from './keys';
import {
  boardActivityOptions,
  discardActivity,
  workspaceActivityOptions,
} from './queries';
import { Timeline } from './Timeline';
import { workspaceAction } from './workspace/decoder';

type EntryProps = { id: ResourceId; identity: SessionIdentity };

export function ActivityScreen({
  id,
  scope,
}: {
  id: ResourceId | null;
  scope: 'workspace' | 'board';
}) {
  const session = useSessionSnapshot();
  if (!id || session.status !== 'authenticated')
    return <ResourceBoundary access="unavailable" />;
  const props = {
    id,
    identity: { userId: session.user.id, generation: session.generation },
  };
  const key = `${session.user.id}:${session.generation}:${scope}:${id}`;
  return scope === 'workspace' ? (
    <WorkspaceHistory key={key} {...props} />
  ) : (
    <BoardHistory key={key} {...props} />
  );
}

function useHistoryScope(
  { id, identity }: EntryProps,
  scope: 'workspace' | 'board',
) {
  const data = useMobileData();
  const active = useIsFocused();
  const online = useWorkspaceOnline();
  const [page, setPage] = useState(1);
  const source = useMemo(
    () =>
      scope === 'workspace'
        ? activityKeys.workspace(identity, id)
        : activityKeys.board(identity, id),
    [scope, identity.userId, identity.generation, id],
  );
  const preferences = useQuery({
    ...datePreferencesOptions(data.api, identity, id),
    enabled: active && online,
  });
  useEffect(() => {
    // A returning screen always starts with a fresh server permission check.
    if (!active) discardActivity(data, identity, source);
    return () => {
      data.cancelResourceRequests(source);
    };
  }, [active, data, source, identity.userId, identity.generation]);
  return {
    data,
    active,
    online,
    page,
    setPage,
    source,
    preferences: preferences.data,
    preferencesReady: preferences.isSuccess,
    identity,
  };
}

function HistoryFrame({
  unavailable,
  children,
}: {
  unavailable: boolean;
  children: ReactNode;
}) {
  const c = useTheme();
  const router = useRouter();
  const active = useIsFocused();
  useEffect(() => {
    if (unavailable && active) router.replace('/boards');
  }, [unavailable, active, router]);
  if (unavailable) return <ResourceBoundary access="unavailable" />;
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <Stack.Screen options={{ title: 'Activity' }} />
      {children}
    </SafeAreaView>
  );
}

function WorkspaceHistory(props: EntryProps) {
  const context = useHistoryScope(props, 'workspace');
  const { data, active, online, page, source } = context;
  const readable = data.resources.readable(source);
  const query = useQuery({
    ...workspaceActivityOptions(data, props.identity, props.id, page),
    enabled: active && online && readable,
    // There is no Workspace audit socket stream. Poll only this active page.
    refetchInterval: active && online ? 30_000 : false,
  });
  return (
    <HistoryFrame unavailable={!readable || isWorkspaceDenied(query.error)}>
      <Timeline
        {...context}
        query={query}
        title="Workspace activity"
        present={(row) => ({
          id: row.id,
          actor: row.actor?.displayName ?? 'Someone',
          action: workspaceAction(row),
          createdAt: row.createdAt,
          context:
            row.board?.name ??
            (row.eventType === 'BOARD_MOVED' ? 'Board unavailable' : undefined),
          target: row.board
            ? { kind: 'board', boardId: row.board.id, workspaceId: props.id }
            : undefined,
        })}
      />
    </HistoryFrame>
  );
}

function BoardHistory(props: EntryProps) {
  const realtime = useRealtime();
  const context = useHistoryScope(props, 'board');
  const { data, active, online, page, source } = context;
  const room = useBoardRealtime(props.id, active, true);
  const retryPending = useRef(false);
  const [retrying, setRetrying] = useState(false);
  async function retryAccess() {
    if (!active || !online || retryPending.current) return;
    retryPending.current = true;
    setRetrying(true);
    try {
      await realtime.retryBoard(props.id);
    } catch {
      // Verification failure keeps the existing access fence and retry control.
    } finally {
      retryPending.current = false;
      setRetrying(false);
    }
  }
  const query = useQuery({
    ...boardActivityOptions(data, props.identity, props.id, page, () =>
      realtime.revokeBoard(props.id),
    ),
    enabled:
      active &&
      online &&
      room.status !== 'checking' &&
      room.status !== 'unavailable',
  });
  const readable = data.resources.readable(source);
  return (
    <HistoryFrame
      unavailable={
        room.status === 'unavailable' || isWorkspaceDenied(query.error)
      }
    >
      {room.status === 'checking' || !readable ? (
        <ErrorState
          title="Checking Board access"
          description="Activity is hidden until access is verified."
          action={
            <Button
              label="Check Board access"
              loading={retrying}
              disabled={!active || !online || retrying}
              onPress={() => void retryAccess()}
            />
          }
        />
      ) : (
        <Timeline
          {...context}
          query={query}
          title="Board activity"
          present={(row) => ({
            id: row.id,
            actor: row.actor?.displayName ?? 'Someone',
            action: boardAction(row),
            createdAt: row.createdAt,
            context: row.entityId === null ? 'Item unavailable' : undefined,
            target: activityCardId(row, props.id)
              ? { kind: 'card', boardId: props.id, event: row }
              : undefined,
          })}
        />
      )}
    </HistoryFrame>
  );
}
