import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, Text, View } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { sizes, typography, useTheme } from '../../ui';
import {
  canRetryWorkspace,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../workspaces/status';
import {
  boardStarKey,
  isBoardStarPending,
  setBoardStar,
  subscribeBoardStars,
} from './star';

export function BoardStar({
  identity,
  id,
  name,
  starred,
  updatedAt,
  disabled,
}: {
  identity: SessionIdentity;
  id: string;
  name: string;
  starred: boolean;
  updatedAt: number;
  disabled: boolean;
}) {
  const data = useMobileData();
  const c = useTheme();
  const key = boardStarKey(identity, id);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; at: number } | null>(
    null,
  );
  const retryReady = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  const busy = useRef(false);
  const sharedPending = useSyncExternalStore(
    (listener) => subscribeBoardStars(data, listener),
    () => isBoardStarPending(data, identity, id),
    () => false,
  );
  const state = useQuery({
    queryKey: key,
    queryFn: () => Promise.resolve({ isStarred: starred, lastViewedAt: null }),
    enabled: false,
    initialData: { isStarred: starred, lastViewedAt: null },
    initialDataUpdatedAt: updatedAt,
  });
  useEffect(() => {
    if (isBoardStarPending(data, identity, id) || !data.resources.readable(key))
      return;
    if ((data.queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) < updatedAt)
      data.queryClient.setQueryData(
        key,
        { isStarred: starred, lastViewedAt: state.data?.lastViewedAt ?? null },
        { updatedAt },
      );
  }, [data, id, identity, starred, updatedAt]);
  if (!data.resources.readable(key)) return null;
  const selected = state.data?.isStarred ?? starred;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${selected ? 'Unstar' : 'Star'} ${name}`}
        accessibilityState={{
          selected,
          disabled: disabled || pending || sharedPending || !retryReady,
        }}
        disabled={disabled || pending || sharedPending || !retryReady}
        onPress={() => {
          if (
            busy.current ||
            !canRetryWorkspace(failure?.error, failure?.at ?? 0) ||
            isBoardStarPending(data, identity, id)
          )
            return;
          busy.current = true;
          setPending(true);
          setFailure(null);
          void setBoardStar(data, identity, id, !selected)
            .catch((error: unknown) => setFailure({ error, at: Date.now() }))
            .finally(() => {
              busy.current = false;
              setPending(false);
            });
        }}
        style={{
          minWidth: sizes.touch,
          minHeight: sizes.touch,
          alignItems: 'center',
          justifyContent: 'center',
          opacity:
            disabled || pending || sharedPending || !retryReady ? 0.55 : 1,
        }}
      >
        <Text
          style={[
            typography.section,
            { color: selected ? c.warning : c.textSecondary },
          ]}
        >
          {selected ? '★' : '☆'}
        </Text>
      </Pressable>
      {failure && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.caption, { color: c.danger }]}
        >
          {workspaceErrorMessage(failure.error)}
        </Text>
      )}
    </View>
  );
}
