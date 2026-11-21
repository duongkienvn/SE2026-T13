import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  BottomSheet,
  Button,
  FilterChip,
  PreferenceSwitch,
  SearchField,
  TextField,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { useWorkspaceRetryReady } from '../workspaces/status';
import {
  filterCount,
  normalizeKanbanFilters,
  type KanbanFilters,
} from './kanban-api';
import type { useKanbanCatalogs } from './kanban-queries';
import { calendarFilters } from '../calendar/queries';

export const dueOptions = [
  ['OVERDUE', 'Overdue'],
  ['DUE_TODAY', 'Due today'],
  ['UPCOMING', 'Upcoming'],
  ['NO_DUE_DATE', 'No due date'],
] as const;
const sortOptions = [
  ['title', 'asc', 'Title A–Z'],
  ['title', 'desc', 'Title Z–A'],
  ['dueDate', 'asc', 'Earliest due date'],
  ['dueDate', 'desc', 'Latest due date'],
] as const;
const row = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: spacing.sm,
} as const;

type Catalogs = ReturnType<typeof useKanbanCatalogs>;

function FilterCatalog({
  title,
  open,
  onToggle,
  items,
  query,
  selected,
  onSelect,
  online,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  items: readonly { id: string; name: string }[];
  query: Catalogs['labels'] | Catalogs['members'];
  selected: readonly string[];
  onSelect: (ids: string[]) => void;
  online: boolean;
}) {
  const c = useTheme();
  const retryReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const denied = query.data?.pages.some((page) => page === null);
  return (
    <View style={{ gap: spacing.sm }}>
      <Button
        label={selected.length ? `${title} (${selected.length})` : title}
        variant="secondary"
        onPress={onToggle}
      />
      {open && (
        <>
          {items.length > 0 && !denied && (
            <View style={row}>
              {items.map((item) => (
                <FilterChip
                  key={item.id}
                  label={item.name}
                  selected={selected.includes(item.id)}
                  disabled={
                    selected.length === 50 && !selected.includes(item.id)
                  }
                  onPress={() =>
                    onSelect(
                      selected.includes(item.id)
                        ? selected.filter((id) => id !== item.id)
                        : [...selected, item.id],
                    )
                  }
                />
              ))}
            </View>
          )}
          {(denied ||
            query.isError ||
            query.isPending ||
            items.length === 0) && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.supporting, { color: c.textSecondary }]}
            >
              {denied || query.isError
                ? `${title} are unavailable.`
                : query.isPaused
                  ? 'Reconnect to load options.'
                  : query.isPending
                    ? 'Loading options…'
                    : 'No options available.'}
            </Text>
          )}
          {query.isError && (
            <Button
              label={`Retry ${title.toLowerCase()}`}
              variant="link"
              disabled={!online || !retryReady || query.isFetching}
              onPress={() =>
                void (query.isFetchNextPageError
                  ? query.fetchNextPage()
                  : query.refetch())
              }
            />
          )}
          {!denied && !query.isError && query.hasNextPage && (
            <Button
              label={`More ${title.toLowerCase()}`}
              variant="link"
              disabled={!online || query.isFetching}
              loading={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage({ cancelRefetch: false })}
            />
          )}
          {selected.length > 0 && (
            <Button
              label={`Clear ${title.toLowerCase()}`}
              variant="link"
              onPress={() => onSelect([])}
            />
          )}
        </>
      )}
    </View>
  );
}

export function BoardFiltersSheet({
  initial,
  startWithLabels,
  catalogs,
  online,
  timeZone,
  onCancel,
  onApply,
  calendar = false,
  columns,
  assigneesAvailable = true,
}: {
  assigneesAvailable?: boolean;
  calendar?: boolean;
  columns?: readonly { id: string; name: string }[];
  initial: KanbanFilters;
  startWithLabels: boolean;
  catalogs: Catalogs;
  online: boolean;
  timeZone?: string;
  onCancel: () => void;
  onApply: (filters: KanbanFilters) => void;
}) {
  const [draft, setDraft] = useState(() =>
    calendar ? calendarFilters(initial) : initial,
  );
  const [error, setError] = useState('');
  const [labelsOpen, setLabelsOpen] = useState(startWithLabels);
  const [membersOpen, setMembersOpen] = useState(false);
  const c = useTheme();
  const update = (patch: Partial<KanbanFilters>) => {
    setError('');
    setDraft((value) => ({ ...value, ...patch }));
  };
  function apply() {
    try {
      normalizeKanbanFilters(draft);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Check your filter values.',
      );
      return;
    }
    onApply(draft);
  }
  return (
    <BottomSheet
      visible
      title={calendar ? 'Calendar filters' : 'Board filters'}
      onDismiss={onCancel}
      dismissLabel="Dismiss filters"
      respectReducedMotion
      showHandle
      footer={
        <>
          {!!error && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.danger }]}
            >
              {error}
            </Text>
          )}
          <View style={[row, { justifyContent: 'space-between' }]}>
            <Button
              label="Reset"
              variant="link"
              onPress={() => {
                setDraft({});
                setError('');
              }}
            />
            <Button label="Cancel" variant="link" onPress={onCancel} />
          </View>
          <Button
            label={`Apply filters (${filterCount(draft)})`}
            onPress={apply}
          />
        </>
      }
    >
      <SearchField
        label="Search cards"
        value={draft.q ?? ''}
        maxLength={200}
        onChangeText={(q) => update({ q })}
      />
      {assigneesAvailable ? (
        <FilterCatalog
          title="Assignees"
          open={membersOpen}
          onToggle={() => setMembersOpen(!membersOpen)}
          items={catalogs.memberItems}
          query={catalogs.members}
          online={online}
          selected={draft.assigneeIds ?? []}
          onSelect={(assigneeIds) => update({ assigneeIds })}
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            Assignee options unavailable for this Board access.
          </Text>
          {!!draft.assigneeIds?.length && (
            <Button
              label="Clear assignees"
              variant="link"
              onPress={() => update({ assigneeIds: [] })}
            />
          )}
        </View>
      )}
      <FilterCatalog
        title="Labels"
        open={labelsOpen}
        onToggle={() => setLabelsOpen(!labelsOpen)}
        items={catalogs.labelItems}
        query={catalogs.labels}
        online={online}
        selected={draft.labelIds ?? []}
        onSelect={(labelIds) => update({ labelIds })}
      />
      {columns && (
        <>
          <Text style={[typography.strong, { color: c.text }]}>Column</Text>
          <View style={row}>
            <FilterChip
              label="All columns"
              selected={!draft.columnId}
              onPress={() => update({ columnId: undefined })}
            />
            {columns.map((column) => (
              <FilterChip
                key={column.id}
                label={column.name}
                selected={draft.columnId === column.id}
                onPress={() => update({ columnId: column.id })}
              />
            ))}
          </View>
        </>
      )}
      <Text style={[typography.strong, { color: c.text }]}>Due date</Text>
      <View style={row}>
        <FilterChip
          label="Any time"
          selected={!draft.dueStatus}
          onPress={() => update({ dueStatus: undefined })}
        />
        {dueOptions
          .filter(([value]) => !calendar || value !== 'NO_DUE_DATE')
          .map(([dueStatus, label]) => (
            <FilterChip
              key={dueStatus}
              label={label}
              selected={draft.dueStatus === dueStatus}
              onPress={() => update({ dueStatus })}
            />
          ))}
      </View>
      {(!calendar || draft.dueFrom || draft.dueTo) && (
        <>
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {calendar
              ? 'Retained Board range (explicit instants). Clear either field or Reset to remove it. '
              : ''}
            {timeZone ? `Your account time zone is ${timeZone}. ` : ''}
            Enter a date and time with a UTC offset, for example
            2026-11-15T09:00+07:00.
          </Text>
          <TextField
            label="Due from (inclusive)"
            value={draft.dueFrom ?? ''}
            maxLength={40}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(dueFrom) => update({ dueFrom })}
          />
          <TextField
            label="Due before (exclusive)"
            value={draft.dueTo ?? ''}
            maxLength={40}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(dueTo) => update({ dueTo })}
          />
        </>
      )}
      {!calendar && (
        <>
          <Text style={[typography.strong, { color: c.text }]}>Sort by</Text>
          <View style={row}>
            <FilterChip
              label="Default order"
              selected={!draft.sortBy}
              onPress={() =>
                update({ sortBy: undefined, sortDirection: undefined })
              }
            />
            {sortOptions.map(([sortBy, sortDirection, label]) => (
              <FilterChip
                key={label}
                label={label}
                selected={
                  draft.sortBy === sortBy &&
                  draft.sortDirection === sortDirection
                }
                onPress={() => update({ sortBy, sortDirection })}
              />
            ))}
          </View>
          <PreferenceSwitch
            label="View archived cards"
            value={draft.status === 'archived'}
            onValueChange={(archived) =>
              update({ status: archived ? 'archived' : undefined })
            }
          />
        </>
      )}
      {calendar && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Active Cards with a due date only.{' '}
          {timeZone ? `Account time zone: ${timeZone}.` : ''} Labels and
          assignees match any selected option within each group.
        </Text>
      )}
    </BottomSheet>
  );
}
