import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { ApiError } from '../../../infrastructure/api/errors';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import {
  AvatarStack,
  Button,
  radius,
  sizes,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { canMutateColumns } from '../../columns/mutations';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
} from '../../workspaces/status';
import type { CardDetailSectionProps } from '../detail/sections';
import { DateEditor } from './DateEditor';
import {
  utcPreferences,
  describeCardDate,
  dueClockDelay,
  type DateField,
} from './dates';
import { AssigneesSheet, LabelsSheet } from './MetadataSheets';
import { runMetadataMutation, type MetadataCommand } from './mutations';
import {
  CardDateValue,
  dateTitles,
  MetadataLabel,
  MetadataMessage,
  metadataError,
} from './presentation';
import {
  datePreferencesOptions,
  resolveAssignees,
  useBoardMetadataCatalogs,
  useCardLabels,
} from './queries';

type Editor =
  | { kind: 'assignees' | 'labels' }
  | { kind: 'date'; field: DateField; original: string | null };

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tile: {
    minHeight: sizes.touch,
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.xs,
  },
});

function useDueClock(value: string | null, active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!value || !active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function refresh() {
      clearTimeout(timer);
      const clock = Date.now();
      setNow(clock);
      if (!value) return;
      const delay = dueClockDelay(value, clock);
      if (delay !== undefined) timer = setTimeout(refresh, delay);
    }
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
      else clearTimeout(timer);
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [value, active]);
  return now;
}

export function CardMetadata({ context }: CardDetailSectionProps) {
  const { identity, board, boardId, cardId, card, active, canEdit } = context;
  const c = useTheme();
  const data = useMobileData();
  const online = useWorkspaceOnline();
  const now = useDueClock(card.dueDate, active);
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / Math.max(fontScale, 1) < 360;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ reason: unknown; at: number }>();
  const request = useRef<AbortController | null>(null);
  const inScope = active && canMutateColumns(board) && !card.isArchived;
  useEffect(() => {
    if (!inScope) {
      request.current?.abort();
      request.current = null;
      setPending(false);
      setFailure(undefined);
      setEditor(null);
    }
    return () => {
      request.current?.abort();
    };
  }, [inScope]);

  const labels = useCardLabels(identity, boardId, cardId, active);
  const preferences = useQuery({
    ...datePreferencesOptions(data.api, identity),
    enabled: active && (inScope || !!(card.startDate || card.dueDate)),
  });
  const rosterAllowed = board.currentUserRole !== null;
  const catalogs = useBoardMetadataCatalogs(
    data.api,
    identity,
    boardId,
    inScope && editor?.kind === 'labels',
    active &&
      rosterAllowed &&
      ((inScope && editor?.kind === 'assignees') || !!card.assignees.length),
  );
  const { members } = catalogs;
  const knownMembers =
    rosterAllowed &&
    members.isFetchedAfterMount &&
    (!members.isError || members.isFetchNextPageError)
      ? catalogs.memberItems
      : [];
  const people = resolveAssignees(card.assignees, knownMembers);
  const unresolved = people.some(
    ({ id }) => !knownMembers.some((member) => member.id === id),
  );
  useEffect(() => {
    if (
      active &&
      online &&
      rosterAllowed &&
      !editor &&
      unresolved &&
      members.hasNextPage &&
      !members.isFetching &&
      !members.isError
    ) {
      void members.fetchNextPage({ cancelRefetch: false });
    }
  }, [
    active,
    online,
    rosterAllowed,
    editor,
    unresolved,
    members.hasNextPage,
    members.isFetching,
    members.isError,
    members.fetchNextPage,
  ]);

  const retry = useWorkspaceRetryReady(failure?.reason, failure?.at ?? 0);
  const retryLabels = useWorkspaceRetryReady(
    labels.error,
    labels.errorUpdatedAt,
  );
  const retryPreferences = useWorkspaceRetryReady(
    preferences.error,
    preferences.errorUpdatedAt,
  );
  const prefs = preferences.data ?? utcPreferences;
  const disabled = !canEdit || pending || !retry || !online;
  const clearError = () =>
    setFailure((previous) =>
      previous?.reason instanceof ApiError && previous.reason.status === 429
        ? previous
        : undefined,
    );
  const close = () => {
    if (request.current) return;
    clearError();
    setEditor(null);
  };
  const open = (next: Editor) => {
    if (!disabled) {
      clearError();
      setEditor(next);
    }
  };
  function run(command: MetadataCommand, done?: () => void) {
    if (disabled || !inScope || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setFailure(undefined);
    void runMetadataMutation(
      data,
      identity,
      boardId,
      cardId,
      command,
      controller.signal,
    )
      .then(() => {
        if (!controller.signal.aborted && request.current === controller) {
          request.current = null;
          done?.();
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && request.current === controller)
          setFailure({ reason, at: Date.now() });
      })
      .finally(() => {
        if (request.current === controller) request.current = null;
        if (!controller.signal.aborted) setPending(false);
      });
  }

  const tile: ViewStyle = {
    ...styles.tile,
    flex: stacked ? undefined : 1,
    minWidth: 0,
    borderColor: c.border,
    backgroundColor: c.surfaceSoft,
  };
  const shownLabels =
    labels.isFetchedAfterMount && !labels.isError ? labels.data : undefined;
  const status = failure
    ? metadataError(failure.reason)
    : !online
      ? 'You’re offline. Reconnect to make changes.'
      : undefined;
  const controls = {
    close,
    run,
    busy: pending,
    disabled,
    error: status,
    clearError,
  };

  return (
    <View testID="card-detail-metadata" style={{ gap: spacing.sm }}>
      <View style={styles.chips}>
        {shownLabels?.map((label) => (
          <MetadataLabel key={label.id} label={label} />
        ))}
        {inScope && (
          <Button
            label="Manage labels"
            variant="link"
            disabled={disabled}
            onPress={() => open({ kind: 'labels' })}
          />
        )}
        {!inScope && shownLabels?.length === 0 && (
          <MetadataMessage>No labels</MetadataMessage>
        )}
      </View>
      {labels.isError && (
        <View style={styles.chips}>
          <MetadataMessage error>{metadataError(labels.error)}</MetadataMessage>
          <Button
            label="Retry labels"
            variant="link"
            disabled={!online || !retryLabels || labels.isFetching}
            onPress={() => void labels.refetch()}
          />
        </View>
      )}
      {labels.isPending && (
        <MetadataMessage>
          {online ? 'Loading labels…' : 'Reconnect to load labels.'}
        </MetadataMessage>
      )}
      <View
        testID="card-detail-metadata-grid"
        style={{ flexDirection: stacked ? 'column' : 'row', gap: spacing.sm }}
      >
        <View style={tile}>
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            Assignees
          </Text>
          {people.length ? (
            <AvatarStack
              size={sizes.iconLarge * Math.max(fontScale, 1)}
              accessibilityLabel={`Assignees: ${people.map(({ name }) => name).join(', ')}`}
              people={people.map(({ name, avatarUrl }) => ({
                name,
                source: avatarUrl ? { uri: avatarUrl } : undefined,
              }))}
            />
          ) : (
            <MetadataMessage>Unassigned</MetadataMessage>
          )}
          {inScope && rosterAllowed && (
            <Button
              label="Manage assignees"
              variant="link"
              disabled={disabled}
              onPress={() => open({ kind: 'assignees' })}
            />
          )}
        </View>
        <View style={tile}>
          {(['startDate', 'dueDate'] as const).map((field) => {
            const content = (
              <>
                <Text
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
                  {dateTitles[field]}
                </Text>
                <CardDateValue
                  field={field}
                  value={card[field]}
                  preferences={prefs}
                  now={now}
                />
              </>
            );
            const value = card[field];
            const absolute = value
              ? describeCardDate(value, prefs).absolute
              : 'not set';
            const changesDisabled =
              disabled || preferences.isFetching || !preferences.isSuccess;
            return inScope ? (
              <Pressable
                key={field}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${dateTitles[field].toLowerCase()}`}
                accessibilityHint={absolute}
                accessibilityState={{ disabled: changesDisabled }}
                disabled={changesDisabled}
                style={({ pressed }) => ({
                  minHeight: sizes.touch,
                  justifyContent: 'center',
                  borderRadius: radius.control,
                  opacity: pressed ? 0.65 : 1,
                })}
                onPress={() => open({ kind: 'date', field, original: value })}
              >
                {content}
              </Pressable>
            ) : (
              <View key={field}>{content}</View>
            );
          })}
        </View>
      </View>
      {preferences.isError && (
        <View style={styles.chips}>
          <MetadataMessage error>
            {preferences.data
              ? 'Couldn’t refresh date preferences.'
              : 'Date preferences are unavailable. Dates are shown in UTC.'}
          </MetadataMessage>
          <Button
            label="Retry date preferences"
            variant="link"
            disabled={!online || !retryPreferences || preferences.isFetching}
            onPress={() => void preferences.refetch()}
          />
        </View>
      )}
      {inScope && rosterAllowed && editor?.kind === 'assignees' && (
        <AssigneesSheet
          {...controls}
          catalogs={catalogs}
          assigned={new Set(card.assignees.map(({ userId }) => userId))}
        />
      )}
      {inScope && editor?.kind === 'labels' && (
        <LabelsSheet {...controls} catalogs={catalogs} assignments={labels} />
      )}
      {inScope && editor?.kind === 'date' && (
        <DateEditor
          field={editor.field}
          original={editor.original}
          current={card[editor.field]}
          counterpart={
            card[editor.field === 'startDate' ? 'dueDate' : 'startDate']
          }
          preferences={prefs}
          disabled={
            disabled || preferences.isFetching || !preferences.isSuccess
          }
          pending={pending}
          error={status}
          close={close}
          save={(command) => run(command, close)}
        />
      )}
    </View>
  );
}
