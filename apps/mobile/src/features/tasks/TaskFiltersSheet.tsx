import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import {
  BottomSheet,
  Button,
  FilterChip,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { useWorkspaceRetryReady } from '../workspaces/status';
import { useTaskCatalogs } from './catalogs';
import {
  emptyTaskSelection,
  selectWorkspace,
  selectBoard,
  taskDateFilters,
  type TaskSelection,
} from './filters';

function CivilDate({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState(false);
  const showing = useRef(false);
  const date = new Date(
    (value || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z',
  );
  const set = (picked: Date) => change(picked.toISOString().slice(0, 10));
  useEffect(
    () => () => {
      if (showing.current)
        void DateTimePickerAndroid.dismiss('date').catch(() => undefined);
    },
    [],
  );
  return (
    <>
      <Button
        label={label + (value ? ': ' + value : ': Any date')}
        variant="secondary"
        onPress={() => {
          if (Platform.OS !== 'android') {
            setPicker(true);
            return;
          }
          if (showing.current) return;
          showing.current = true;
          setError(false);
          DateTimePickerAndroid.open({
            value: date,
            mode: 'date',
            timeZoneName: 'UTC',
            onValueChange: (_event, picked) => {
              showing.current = false;
              set(picked);
            },
            onDismiss: () => {
              showing.current = false;
            },
            onError: () => {
              showing.current = false;
              setError(true);
            },
          });
        }}
      />
      {error && (
        <Text accessibilityLiveRegion="polite">
          Couldn’t open the date picker. Try again.
        </Text>
      )}
      {!!value && (
        <Button
          label={'Clear ' + label.toLowerCase()}
          variant="link"
          onPress={() => change('')}
        />
      )}
      {picker && (
        <DateTimePicker
          value={date}
          mode="date"
          timeZoneName="UTC"
          onValueChange={(_event, picked) => {
            setPicker(false);
            set(picked);
          }}
          onDismiss={() => setPicker(false)}
        />
      )}
    </>
  );
}

export function TaskFiltersSheet({
  identity,
  current,
  timeZone,
  online,
  close,
  apply,
}: {
  identity: SessionIdentity;
  current: TaskSelection;
  timeZone: string;
  online: boolean;
  close: () => void;
  apply: (selection: TaskSelection) => void;
}) {
  const c = useTheme();
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const { workspaces, boards, access, labels, boardItems, labelItems } =
    useTaskCatalogs(identity, draft.workspaceId, draft.boardId, online);
  const workspaceReady = useWorkspaceRetryReady(
    workspaces.error,
    workspaces.errorUpdatedAt,
  );
  const boardReady = useWorkspaceRetryReady(
    boards.error,
    boards.errorUpdatedAt,
  );
  const labelReady = useWorkspaceRetryReady(
    labels.error,
    labels.errorUpdatedAt,
  );
  const accessReady = useWorkspaceRetryReady(
    access.error,
    access.errorUpdatedAt,
  );
  const unavailableLabels = labels.data?.pages.some((page) => page === null);
  const dirty = JSON.stringify(current) !== JSON.stringify(draft);
  const dismiss = () => {
    if (discard) setDiscard(false);
    else if (dirty) setDiscard(true);
    else close();
  };
  return (
    <BottomSheet
      visible
      title={discard ? 'Discard filter changes?' : 'Filter tasks'}
      showHandle
      respectReducedMotion
      onDismiss={dismiss}
      dismissLabel="Close task filters"
      footer={
        discard ? (
          <>
            <Button
              label="Discard changes"
              variant="destructive"
              onPress={close}
            />
            <Button
              label="Keep editing"
              variant="secondary"
              onPress={() => setDiscard(false)}
            />
          </>
        ) : (
          <>
            <Button
              label="Apply filters"
              disabled={
                !online ||
                (!!draft.boardId && (!access.isSuccess || access.isFetching)) ||
                (!!draft.labelIds.length &&
                  (labels.isError || unavailableLabels || labels.isFetching))
              }
              onPress={() => {
                try {
                  taskDateFilters(draft, timeZone);
                  apply(draft);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Check the date range.',
                  );
                }
              }}
            />
            <Button label="Cancel" variant="secondary" onPress={dismiss} />
          </>
        )
      }
    >
      {!discard && (
        <>
          <Button
            label="Reset filters"
            variant="link"
            onPress={() => {
              setDraft(emptyTaskSelection);
              setError('');
            }}
          />
          <Text
            accessibilityRole="header"
            style={[typography.strong, { color: c.text }]}
          >
            Workspace
          </Text>
          <FilterChip
            label="All workspaces"
            selected={!draft.workspaceId}
            onPress={() => setDraft(selectWorkspace(draft))}
          />
          {workspaces.isFetching && (
            <Text style={{ color: c.textSecondary }}>Loading workspaces…</Text>
          )}
          {workspaces.isError ? (
            <Button
              label="Retry workspaces"
              disabled={!online || !workspaceReady}
              onPress={() => void workspaces.refetch()}
            />
          ) : (
            workspaces.data?.map((workspace) => (
              <FilterChip
                key={workspace.id}
                label={workspace.name}
                selected={draft.workspaceId === workspace.id}
                onPress={() => setDraft(selectWorkspace(draft, workspace.id))}
              />
            ))
          )}
          <Text
            accessibilityRole="header"
            style={[typography.strong, { color: c.text }]}
          >
            Board
          </Text>
          <FilterChip
            label="All boards"
            selected={!draft.boardId}
            onPress={() => setDraft(selectBoard(draft))}
          />
          {boards.isFetching && (
            <Text style={{ color: c.textSecondary }}>Loading boards…</Text>
          )}
          {boards.isError ? (
            <Button
              label="Retry boards"
              disabled={!online || !boardReady}
              onPress={() => void boards.refetch()}
            />
          ) : (
            boardItems.map((board) => (
              <FilterChip
                key={board.id}
                label={board.name}
                selected={draft.boardId === board.id}
                onPress={() => setDraft(selectBoard(draft, board.id))}
              />
            ))
          )}
          {boards.hasNextPage && (
            <Button
              label="More boards"
              variant="link"
              disabled={boards.isFetching || !online || !boardReady}
              onPress={() => void boards.fetchNextPage()}
            />
          )}
          <Text
            accessibilityRole="header"
            style={[typography.strong, { color: c.text }]}
          >
            Labels · match any
          </Text>
          {!draft.boardId && (
            <Text style={{ color: c.textSecondary }}>
              Select a Board to filter labels.
            </Text>
          )}
          {!!draft.boardId && (!access.isSuccess || access.isFetching) && (
            <Text style={{ color: c.textSecondary }}>
              Checking Board access…
            </Text>
          )}
          {access.isError && (
            <Button
              label="Retry Board access"
              disabled={!online || !accessReady}
              onPress={() => void access.refetch()}
            />
          )}
          {unavailableLabels && (
            <Text style={{ color: c.textSecondary }}>
              Labels are unavailable for this Board. Clear labels to continue.
            </Text>
          )}
          {labels.isFetching && (
            <Text style={{ color: c.textSecondary }}>Loading labels…</Text>
          )}
          {labels.isError && (
            <Button
              label="Retry labels"
              disabled={!online || !labelReady}
              onPress={() => void labels.refetch()}
            />
          )}
          {!!draft.boardId &&
            !access.isError &&
            !unavailableLabels &&
            !labels.isError && (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                }}
              >
                {labelItems.map((label) => (
                  <FilterChip
                    key={label.id}
                    label={label.name}
                    selected={draft.labelIds.includes(label.id)}
                    disabled={
                      !draft.labelIds.includes(label.id) &&
                      draft.labelIds.length >= 50
                    }
                    onPress={() =>
                      setDraft({
                        ...draft,
                        labelIds: draft.labelIds.includes(label.id)
                          ? draft.labelIds.filter((id) => id !== label.id)
                          : [...draft.labelIds, label.id],
                      })
                    }
                  />
                ))}
              </View>
            )}
          {labels.hasNextPage && (
            <Button
              label="More labels"
              variant="link"
              disabled={labels.isFetching || !online || !labelReady}
              onPress={() => void labels.fetchNextPage()}
            />
          )}
          {!!draft.labelIds.length && (
            <Button
              label="Clear selected labels"
              variant="link"
              onPress={() => setDraft({ ...draft, labelIds: [] })}
            />
          )}
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            Dates in {timeZone}. Due through includes the selected day.
          </Text>
          <CivilDate
            label="Due from"
            value={draft.dueFrom}
            change={(value) => setDraft({ ...draft, dueFrom: value })}
          />
          <CivilDate
            label="Due through"
            value={draft.dueThrough}
            change={(value) => setDraft({ ...draft, dueThrough: value })}
          />
          <Text
            accessibilityRole="header"
            style={[typography.strong, { color: c.text }]}
          >
            Sort
          </Text>
          {(
            [
              ['dueDate', 'Due date'],
              ['updatedAt', 'Recently updated'],
              ['board', 'Board name'],
            ] as const
          ).map(([sort, label]) => (
            <FilterChip
              key={sort}
              label={label}
              selected={draft.sort === sort}
              onPress={() => setDraft({ ...draft, sort })}
            />
          ))}
          {!!error && (
            <Text accessibilityLiveRegion="polite" style={{ color: c.danger }}>
              {error}
            </Text>
          )}
        </>
      )}
    </BottomSheet>
  );
}
