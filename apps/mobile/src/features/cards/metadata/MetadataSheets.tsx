import { useState } from 'react';
import { Keyboard, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Checkbox,
  ListRow,
  SearchField,
  TextField,
  radius,
  spacing,
  useTheme,
} from '../../../ui';
import type { KanbanLabel } from '../../boards/kanban-api';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
} from '../../workspaces/status';
import { labelFields, labelPatch, type LabelFields } from './api';
import type { MetadataCommand } from './mutations';
import {
  AssigneeAvatar,
  DiscardMetadataActions,
  MetadataMessage,
  metadataError,
} from './presentation';
import type { useBoardMetadataCatalogs, useCardLabels } from './queries';

type Catalogs = ReturnType<typeof useBoardMetadataCatalogs>;
type Action = (command: MetadataCommand, done?: () => void) => void;
type Controls = {
  close: () => void;
  run: Action;
  busy: boolean;
  disabled: boolean;
  error?: string;
  clearError: () => void;
};

function Pager({
  query,
  noun,
}: {
  query: Catalogs['members'] | Catalogs['labels'];
  noun: string;
}) {
  const online = useWorkspaceOnline();
  const retry = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const lastPage = query.data?.pages.at(-1);
  if (query.isError)
    return (
      <>
        <MetadataMessage error>{metadataError(query.error)}</MetadataMessage>
        <Button
          label={`Retry ${noun}`}
          variant="link"
          disabled={!online || !retry || query.isFetching}
          onPress={() =>
            void (query.isFetchNextPageError
              ? query.fetchNextPage({ cancelRefetch: false })
              : query.refetch())
          }
        />
      </>
    );
  if (lastPage === null)
    return (
      <MetadataMessage>{`This board’s ${noun} are unavailable.`}</MetadataMessage>
    );
  if (query.isPending)
    return (
      <MetadataMessage>
        {online ? `Loading ${noun}…` : `Reconnect to load ${noun}.`}
      </MetadataMessage>
    );
  if (!query.hasNextPage) return null;
  return (
    <>
      <MetadataMessage>{`Search covers loaded ${noun}. Load more for additional results.`}</MetadataMessage>
      <Button
        label={`Load more ${noun}`}
        variant="secondary"
        disabled={!online || query.isFetching}
        loading={query.isFetchingNextPage}
        onPress={() => void query.fetchNextPage({ cancelRefetch: false })}
      />
    </>
  );
}

export function AssigneesSheet({
  catalogs,
  assigned,
  close,
  run,
  busy,
  disabled,
  error,
  clearError,
}: Controls & { catalogs: Catalogs; assigned: ReadonlySet<string> }) {
  const [search, setSearch] = useState('');
  const { members } = catalogs;
  const items =
    !members.isFetchedAfterMount ||
    (members.isError && !members.isFetchNextPageError)
      ? []
      : catalogs.memberItems;
  const visible = items.filter(({ name }) =>
    name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <BottomSheet
      visible
      title="Manage assignees"
      onDismiss={close}
      dismissible={!busy}
      showHandle
      respectReducedMotion
      dismissLabel="Dismiss assignees"
      footer={
        <Button
          label="Done"
          variant="secondary"
          disabled={busy}
          onPress={close}
        />
      }
    >
      <SearchField
        label="Search board members"
        value={search}
        onChangeText={(value) => {
          setSearch(value);
          clearError();
        }}
      />
      {error && <MetadataMessage error>{error}</MetadataMessage>}
      {busy && <MetadataMessage>Saving assignees…</MetadataMessage>}
      {!visible.length &&
        members.isSuccess &&
        members.data.pages.at(-1) !== null && (
          <MetadataMessage>
            {search
              ? 'No matches among loaded members.'
              : 'No eligible board members.'}
          </MetadataMessage>
        )}
      {visible.map((member) => {
        const selected = assigned.has(member.id);
        return (
          <View
            key={member.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
            }}
          >
            <AssigneeAvatar member={member} />
            <View style={{ flex: 1 }}>
              <Checkbox
                label={member.name}
                checked={selected}
                disabled={disabled || members.isFetching || members.isError}
                onValueChange={() =>
                  run({
                    kind: selected ? 'unassignMember' : 'assignMember',
                    id: member.id,
                  })
                }
              />
            </View>
          </View>
        );
      })}
      <Pager query={members} noun="members" />
    </BottomSheet>
  );
}

type LabelView =
  | { kind: 'assign' }
  | { kind: 'catalog' }
  | { kind: 'edit'; label?: KanbanLabel }
  | { kind: 'confirm'; label: KanbanLabel };

export function LabelsSheet({
  catalogs,
  assignments,
  close,
  run,
  busy,
  disabled,
  error,
  clearError,
}: Controls & {
  catalogs: Catalogs;
  assignments: ReturnType<typeof useCardLabels>;
}) {
  const [view, setView] = useState<LabelView>({ kind: 'assign' });
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const c = useTheme();
  const { labels, labelItems } = catalogs;
  const select = (next: LabelView) => {
    clearError();
    setDirty(false);
    setDiscarding(false);
    setView(next);
  };
  const listReady =
    labels.isFetchedAfterMount &&
    (labels.isSuccess || labels.isFetchNextPageError) &&
    labels.data?.pages.at(-1) !== null;
  const assigned = assignments.isSuccess ? assignments.data : [];
  const catalogLabels = new Map(
    (listReady ? labelItems : []).map((label) => [label.id, label]),
  );
  const allLabels = new Map(catalogLabels);
  const assignedIds = new Set(assigned.map(({ id }) => id));
  if (view.kind === 'assign')
    for (const label of assigned) allLabels.set(label.id, label);
  const matches = [...allLabels.values()].filter(({ name }) =>
    name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const back = () => {
    if (view.kind === 'assign') close();
    else if (view.kind === 'catalog') select({ kind: 'assign' });
    else select({ kind: 'catalog' });
  };
  const dismiss = () => {
    if (discarding) setDiscarding(false);
    else if (view.kind === 'edit' && dirty) {
      Keyboard.dismiss();
      setDiscarding(true);
    } else back();
  };
  const title =
    view.kind === 'assign'
      ? 'Manage labels'
      : view.kind === 'catalog'
        ? 'Board labels'
        : view.kind === 'confirm'
          ? 'Delete board label?'
          : view.label
            ? 'Edit label'
            : 'Create label';

  return (
    <BottomSheet
      visible
      title={discarding ? 'Discard label changes?' : title}
      onDismiss={dismiss}
      dismissible={!busy}
      showHandle
      respectReducedMotion
      dismissLabel={
        view.kind === 'assign' ? 'Dismiss labels' : 'Back to labels'
      }
      footer={
        discarding ? (
          <DiscardMetadataActions
            keepEditing={() => setDiscarding(false)}
            discard={back}
          />
        ) : (
          <Button
            label={
              view.kind === 'assign'
                ? 'Done'
                : view.kind === 'catalog'
                  ? 'Back'
                  : 'Cancel'
            }
            variant="secondary"
            disabled={busy}
            onPress={back}
          />
        )
      }
    >
      {discarding && (
        <MetadataMessage>
          Your label changes haven’t been saved.
        </MetadataMessage>
      )}
      {!discarding && error && <MetadataMessage error>{error}</MetadataMessage>}
      {busy && <MetadataMessage>Saving labels…</MetadataMessage>}
      {(view.kind === 'assign' || view.kind === 'catalog') && (
        <>
          <Button
            label={
              view.kind === 'assign' ? 'Manage board labels' : 'Create label'
            }
            variant={view.kind === 'assign' ? 'secondary' : 'primary'}
            disabled={disabled}
            onPress={() => {
              setSearch('');
              select(
                view.kind === 'assign' ? { kind: 'catalog' } : { kind: 'edit' },
              );
            }}
          />
          <SearchField
            label="Search labels"
            value={search}
            onChangeText={setSearch}
          />
          {view.kind === 'assign' && assignments.isError && (
            <>
              <MetadataMessage error>
                {metadataError(assignments.error)}
              </MetadataMessage>
              <Button
                label="Retry card labels"
                variant="link"
                disabled={disabled}
                onPress={() => void assignments.refetch()}
              />
            </>
          )}
          {!matches.length && listReady && (
            <MetadataMessage>
              {search ? 'No matches among loaded labels.' : 'No labels yet.'}
            </MetadataMessage>
          )}
          {matches.map((label) => {
            const selected = assignedIds.has(label.id);
            const catalog = view.kind === 'catalog';
            const swatch = (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: radius.pill,
                  backgroundColor: label.color,
                  borderColor: c.controlBorder,
                  borderWidth: 1,
                }}
              />
            );
            return (
              <View key={label.id}>
                {catalog ? (
                  <ListRow
                    title={label.name}
                    leading={swatch}
                    accessibilityLabel={`Edit ${label.name}`}
                    disabled={disabled || labels.isFetching}
                    onPress={() => select({ kind: 'edit', label })}
                  />
                ) : (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                    }}
                  >
                    {swatch}
                    <View style={{ flex: 1 }}>
                      <Checkbox
                        label={label.name}
                        checked={selected}
                        disabled={
                          disabled ||
                          assignments.isFetching ||
                          !assignments.isSuccess ||
                          (!selected &&
                            (!catalogLabels.has(label.id) ||
                              labels.isFetching ||
                              labels.isError))
                        }
                        onValueChange={() =>
                          run({
                            kind: selected ? 'unassignLabel' : 'assignLabel',
                            id: label.id,
                          })
                        }
                      />
                    </View>
                  </View>
                )}
              </View>
            );
          })}
          <Pager query={labels} noun="labels" />
        </>
      )}
      {view.kind === 'edit' && (
        <View style={discarding ? { display: 'none' } : { gap: spacing.lg }}>
          <LabelForm
            label={view.label}
            labels={listReady ? labelItems : []}
            busy={busy}
            disabled={disabled}
            run={run}
            close={back}
            clearError={clearError}
            onDirtyChange={setDirty}
            confirm={(label) => select({ kind: 'confirm', label })}
          />
        </View>
      )}
      {view.kind === 'confirm' && (
        <>
          <MetadataMessage>{`Delete “${view.label.name}” from this board? This also removes it from every card that uses it.`}</MetadataMessage>
          <Button
            label="Delete label"
            variant="destructive"
            loading={busy}
            disabled={disabled}
            onPress={() =>
              run({ kind: 'deleteLabel', id: view.label.id }, back)
            }
          />
        </>
      )}
    </BottomSheet>
  );
}

function LabelForm({
  label,
  labels,
  disabled,
  busy,
  run,
  close,
  confirm,
  clearError,
  onDirtyChange,
}: {
  label?: KanbanLabel;
  labels: KanbanLabel[];
  disabled: boolean;
  busy: boolean;
  run: Action;
  close: () => void;
  confirm: (label: KanbanLabel) => void;
  clearError: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [fields, setFields] = useState<LabelFields>(() =>
    label
      ? { name: label.name, color: label.color }
      : { name: '', color: '#615CF7' },
  );
  const [error, setError] = useState<string>();
  const isDirty = (next: LabelFields) =>
    next.name.trim() !== (label?.name ?? '') ||
    next.color.trim().toUpperCase() !== (label?.color ?? '#615CF7');
  const setField = (key: keyof LabelFields, value: string) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    onDirtyChange(isDirty(next));
    clearError();
    setError(undefined);
  };
  function save() {
    try {
      const next = labelFields(fields);
      const patch = label ? labelPatch(next, label) : null;
      if (patch && !Object.keys(patch).length) return close();
      if (
        labels.some(
          (item) =>
            item.id !== label?.id &&
            item.name.toLowerCase() === next.name.toLowerCase(),
        )
      ) {
        setError('A board label already uses this name.');
        return;
      }
      run(
        label && patch
          ? { kind: 'updateLabel', id: label.id, fields: patch }
          : { kind: 'createLabel', fields: next },
        close,
      );
    } catch (failure) {
      setError(metadataError(failure));
    }
  }
  return (
    <>
      <TextField
        label="Label name"
        value={fields.name}
        editable={!busy}
        onChangeText={(value) => setField('name', value)}
      />
      <TextField
        label="Color"
        hint="Six hex digits, for example #615CF7"
        value={fields.color}
        editable={!busy}
        autoCapitalize="characters"
        autoCorrect={false}
        onChangeText={(value) => setField('color', value)}
      />
      {error && <MetadataMessage error>{error}</MetadataMessage>}
      <Button
        label="Save label"
        onPress={save}
        disabled={disabled}
        loading={busy}
      />
      {label && (
        <Button
          label="Delete label"
          variant="destructive"
          disabled={disabled || isDirty(fields)}
          onPress={() => confirm(label)}
        />
      )}
    </>
  );
}
