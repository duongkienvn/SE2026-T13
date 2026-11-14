import { useQuery } from '@tanstack/react-query';
import type { BoardBackgroundPresetId } from '@kanban/shared';
import { Pressable, Text, View } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { Button, spacing, typography, useTheme } from '../../ui';
import { BoardArtwork } from '../home/BoardArtwork';
import {
  canRetryWorkspace,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../workspaces/status';
import { createBoardApi } from './api';

export function BackgroundPicker({
  identity,
  value,
  onChange,
  disabled,
}: {
  identity: SessionIdentity;
  value?: BoardBackgroundPresetId;
  onChange: (value: BoardBackgroundPresetId) => void;
  disabled: boolean;
}) {
  const data = useMobileData();
  const c = useTheme();
  const catalog = useQuery({
    queryKey: [...queryKeys.scope(identity), 'board-background-presets'],
    queryFn: ({ signal }) => createBoardApi(data.api, identity).catalog(signal),
  });
  const retryReady = useWorkspaceRetryReady(
    catalog.error,
    catalog.errorUpdatedAt,
  );
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.strong, { color: c.text }]}>Background</Text>
      {catalog.isPending && (
        <Text style={{ color: c.textSecondary }}>Loading backgrounds…</Text>
      )}
      {catalog.isError && (
        <>
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.textSecondary }]}
          >
            {workspaceErrorMessage(catalog.error)}
          </Text>
          <Button
            label="Retry backgrounds"
            variant="secondary"
            disabled={disabled || catalog.isFetching || !retryReady}
            onPress={() => {
              if (canRetryWorkspace(catalog.error, catalog.errorUpdatedAt))
                void catalog.refetch();
            }}
          />
        </>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {catalog.data?.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Background ${item.id}`}
            accessibilityState={{ selected: item.id === value, disabled }}
            disabled={disabled}
            onPress={() => onChange(item.id)}
            style={{
              minWidth: 64,
              minHeight: 64,
              alignItems: 'center',
              gap: spacing.xs,
              borderWidth: 2,
              borderColor: item.id === value ? c.focus : 'transparent',
            }}
          >
            <BoardArtwork preset={item.id} />
            <Text style={[typography.caption, { color: c.text }]}>
              {item.id}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
