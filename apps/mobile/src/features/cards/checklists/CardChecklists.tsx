import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../../infrastructure/api/errors';
import {
  BottomSheet,
  Button,
  Checkbox,
  ErrorState,
  ProgressBar,
  Separator,
  Skeleton,
  Surface,
  TextField,
  radius,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../../workspaces/status';
import type { CardDetailSectionProps } from '../detail/sections';
import { moveAnchor, type CardPlacement } from '../ordering';
import {
  ITEM_LENGTH,
  MAX_CHECKLISTS,
  MAX_ITEMS,
  TITLE_LENGTH,
  textError,
  type Progress,
  type Checklist,
} from './api';
import { useChecklistMutation, useChecklists } from './hooks';
import { checklistRows, isUncertainCreate } from './queries';

type Target = { checklistId: string; itemId?: string };
type Form = {
  mode: 'form';
  target?: Target;
  action: 'Create checklist' | 'Rename checklist' | 'Add item' | 'Edit item';
  initial: string;
};
type Sheet = Form | { mode: 'menu' | 'delete'; target: Target };
const placements: [CardPlacement, string][] = [
  ['up', 'Move up'],
  ['down', 'Move down'],
  ['top', 'Move to top'],
  ['bottom', 'Move to bottom'],
];

function ProgressLine({
  progress,
  label,
}: {
  progress: Progress;
  label: string;
}) {
  const c = useTheme();
  const { checkedItems, totalItems, completionPercentage } = progress;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.line}>
        <Text style={[typography.strong, styles.number, { color: c.text }]}>
          {completionPercentage}% complete
        </Text>
        <Text
          style={[
            typography.supporting,
            styles.number,
            { color: c.primaryPressed },
          ]}
        >
          {checkedItems} of {totalItems}
        </Text>
      </View>
      <ProgressBar
        label={`${label}: ${checkedItems} of ${totalItems} complete`}
        value={completionPercentage}
      />
    </View>
  );
}

function SectionIcon() {
  const c = useTheme();
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.icon, { borderColor: c.primaryPressed }]}
    >
      <View style={[styles.check, { borderColor: c.primaryPressed }]} />
    </View>
  );
}

function Options({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Button
      label={label}
      disabled={disabled}
      onPress={onPress}
      variant="icon"
      icon={
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.dots}
        >
          {[0, 1, 2].map((dot) => (
            <View
              key={dot}
              style={[styles.dot, { backgroundColor: c.textSecondary }]}
            />
          ))}
        </View>
      }
    />
  );
}

function Note({
  children,
  issue = false,
}: {
  children: ReactNode;
  issue?: boolean;
}) {
  const c = useTheme();
  return (
    <Text
      accessibilityLiveRegion={issue ? 'polite' : 'none'}
      style={[
        typography.supporting,
        { color: issue ? c.danger : c.textSecondary },
      ]}
    >
      {children}
    </Text>
  );
}

function writeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403 || error.status === 404)
      return 'This change is no longer available. Check the latest checklist.';
    if (error.kind === 'session-changed')
      return 'Access changed. Check the latest checklist before trying again.';
    if (error.kind === 'network')
      return 'Connection lost. Check the latest checklist before trying again.';
    if (error.status === 0 || [400, 409, 429].includes(error.status))
      return workspaceErrorMessage(error);
  }
  return 'Couldn’t confirm the change. Check the latest checklist before trying again.';
}

function ChecklistPanel({
  checklist,
  mayEdit,
  pending,
  canAdd,
  writeRetry,
  open,
  onToggle,
}: {
  checklist: Checklist;
  mayEdit: boolean;
  pending: ReturnType<typeof useChecklistMutation>['pending'];
  canAdd: boolean;
  writeRetry: boolean;
  open: (sheet: Sheet) => void;
  onToggle: (itemId: string, isChecked: boolean) => void;
}) {
  const c = useTheme();
  const saving = !!pending;
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={styles.line}>
        <Text
          accessibilityRole="header"
          style={[typography.strong, styles.flex, { color: c.text }]}
        >
          {checklist.title}
        </Text>
        {mayEdit && (
          <View style={styles.actions}>
            <Button
              label="Add item"
              accessibilityLabel={`Add item to ${checklist.title}`}
              variant="link"
              disabled={
                saving || !canAdd || checklist.items.length >= MAX_ITEMS
              }
              onPress={() =>
                open({
                  mode: 'form',
                  action: 'Add item',
                  target: { checklistId: checklist.id },
                  initial: '',
                })
              }
            />
            <Options
              label={`Actions for checklist ${checklist.title}`}
              disabled={saving}
              onPress={() =>
                open({
                  mode: 'menu',
                  target: { checklistId: checklist.id },
                })
              }
            />
          </View>
        )}
      </View>
      {mayEdit && checklist.items.length >= MAX_ITEMS && (
        <Note>This checklist has reached its 200 item limit.</Note>
      )}
      <Surface compact>
        <View style={{ gap: spacing.sm }}>
          <ProgressLine label={checklist.title} progress={checklist} />
          {!checklist.items.length && <Note>No items</Note>}
          {checklist.items.map((entry, index) => {
            const toggling = pending?.itemId === entry.id;
            return (
              <View key={entry.id}>
                {index > 0 && <Separator />}
                <View style={styles.itemRow}>
                  <View style={styles.flex}>
                    <Checkbox
                      label={entry.text}
                      checked={toggling ? pending.desired! : entry.isChecked}
                      strikeThroughWhenChecked
                      disabled={
                        !mayEdit ||
                        !writeRetry ||
                        (saving && (!toggling || pending.settling))
                      }
                      onValueChange={(isChecked) =>
                        onToggle(entry.id, isChecked)
                      }
                    />
                  </View>
                  {mayEdit && (
                    <Options
                      label={`Actions for item ${entry.text}`}
                      disabled={saving}
                      onPress={() =>
                        open({
                          mode: 'menu',
                          target: {
                            checklistId: checklist.id,
                            itemId: entry.id,
                          },
                        })
                      }
                    />
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </Surface>
    </View>
  );
}

export function CardChecklists({ context }: CardDetailSectionProps) {
  const c = useTheme();
  const query = useChecklists(context);
  const online = useWorkspaceOnline();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<{ value: unknown; at: number } | null>(
    null,
  );
  const [uncertain, setUncertain] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const readRetry = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const writeRetry = useWorkspaceRetryReady(error?.value, error?.at ?? 0);
  const hidden =
    query.error instanceof ApiError &&
    ([401, 403, 404].includes(query.error.status) ||
      query.error.kind === 'session-changed');
  const list = !hidden && query.isFetchedAfterMount ? query.data : undefined;
  const readOnly =
    context.board.isArchived ||
    context.card.isArchived ||
    !context.board.capabilities.canWriteBoard;
  const mayEdit = context.canEdit && !readOnly && !query.isError && !!list;
  const { run, pending } = useChecklistMutation({
    ...context,
    canEdit: mayEdit,
  });
  // A commit hint can arrive before the matching HTTP response. Keep the
  // displayed rows and counts stable until this batch finishes reconciling.
  const displayed = list && (pending?.snapshot ?? list);
  const row =
    sheet?.target &&
    displayed?.checklists.find(({ id }) => id === sheet.target?.checklistId);
  const item = row?.items.find(({ id }) => id === sheet?.target?.itemId);
  const moves =
    sheet?.target && displayed
      ? checklistRows(displayed, sheet.target).map(({ id }) => id)
      : [];
  const moveId = item?.id ?? row?.id;
  const saving = !!pending;
  const open = (next: Sheet) => {
    setError(null);
    setUncertain(false);
    setDiscard(false);
    setText(next.mode === 'form' ? next.initial : '');
    setSheet(next);
  };
  useEffect(() => {
    if (hidden || readOnly || !context.active) {
      setSheet(null);
      setText('');
      setError(null);
      setUncertain(false);
      setNeedsReview(false);
      setDiscard(false);
    }
  }, [hidden, readOnly, context.active]);

  const save = async (command: Parameters<typeof run>[0], close = true) => {
    setError(null);
    try {
      if ((await run(command)) && close) setSheet(null);
    } catch (value) {
      setError({ value, at: Date.now() });
      if (
        (command.kind === 'create' || command.kind === 'addItem') &&
        isUncertainCreate(value)
      ) {
        setUncertain(true);
        setNeedsReview(true);
      }
    }
  };
  const refresh = () => void query.refetch();
  const review = async () => {
    const result = await query.refetch();
    if (result.isSuccess) setNeedsReview(false);
  };
  const formIsItem =
    sheet?.mode === 'form' &&
    (sheet.action === 'Add item' || sheet.action === 'Edit item');
  const fieldError = textError(text, formIsItem ? ITEM_LENGTH : TITLE_LENGTH);
  const staleForm =
    sheet?.mode === 'form' &&
    (sheet.action === 'Rename checklist'
      ? row?.title !== sheet.initial
      : sheet.action === 'Edit item'
        ? item?.text !== sheet.initial
        : false);
  const atFormLimit =
    sheet?.mode === 'form' &&
    (sheet.action === 'Create checklist'
      ? list?.checklists.length === MAX_CHECKLISTS
      : sheet.action === 'Add item' && row?.items.length === MAX_ITEMS);
  const submit = () => {
    if (
      sheet?.mode !== 'form' ||
      !mayEdit ||
      saving ||
      !writeRetry ||
      fieldError ||
      staleForm ||
      atFormLimit ||
      uncertain
    )
      return;
    if (sheet.action === 'Create checklist')
      void save({ kind: 'create', title: text });
    else if (sheet.action === 'Rename checklist' && row)
      void save({ kind: 'rename', checklistId: row.id, title: text });
    else if (sheet.action === 'Add item' && row)
      void save({ kind: 'addItem', checklistId: row.id, text });
    else if (sheet.action === 'Edit item' && row && item)
      void save({
        kind: 'editItem',
        checklistId: row.id,
        itemId: item.id,
        text,
      });
  };
  const dismiss = () => {
    if (saving) return;
    if (discard) setDiscard(false);
    else if (sheet?.mode === 'form' && text.trim() !== sheet.initial)
      setDiscard(true);
    else setSheet(null);
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.line}>
        <View style={styles.heading}>
          <SectionIcon />
          <Text
            accessibilityRole="header"
            style={[typography.strong, styles.flex, { color: c.text }]}
          >
            Checklists
          </Text>
        </View>
        {mayEdit && (
          <Button
            label="Add checklist"
            variant="link"
            disabled={
              saving || needsReview || list.checklists.length >= MAX_CHECKLISTS
            }
            onPress={() =>
              open({ mode: 'form', action: 'Create checklist', initial: '' })
            }
          />
        )}
      </View>
      {!online && !query.isError && (
        <Note>
          {displayed
            ? 'You’re offline. Showing the last loaded checklists.'
            : 'Reconnect to load checklists.'}
        </Note>
      )}
      {online && !list && !query.isError && (
        <Surface compact>
          <View style={{ gap: spacing.md }}>
            <Skeleton width="45%" height={18} label="Loading checklists" />
            <Skeleton height={8} />
            <Skeleton width="75%" height={24} />
          </View>
        </Surface>
      )}
      {query.isError && (
        <ErrorState
          title={hidden ? 'Checklists unavailable' : 'Couldn’t load checklists'}
          description={
            hidden
              ? 'Retry to check what’s available.'
              : displayed
                ? 'Showing the last loaded checklists. Retry to update progress.'
                : workspaceErrorMessage(query.error)
          }
          action={
            <Button
              label="Retry checklists"
              variant="link"
              disabled={!online || !readRetry || saving || query.isFetching}
              onPress={refresh}
            />
          }
        />
      )}
      {!sheet && error && <Note issue>{writeError(error.value)}</Note>}
      {!sheet && needsReview && (
        <>
          <Note issue>
            Reload and review the checklists before adding again.
          </Note>
          <Button
            label="Reload checklists"
            variant="link"
            disabled={!online || !readRetry || saving || query.isFetching}
            onPress={() => void review()}
          />
        </>
      )}
      {displayed && displayed.checklists.length !== 1 && (
        <Surface compact>
          <View style={{ gap: spacing.md }}>
            {!displayed.checklists.length && <Note>No checklists</Note>}
            <ProgressLine
              label="Card checklist progress"
              progress={displayed}
            />
          </View>
        </Surface>
      )}
      {mayEdit && list.checklists.length >= MAX_CHECKLISTS && (
        <Note>This card has reached its 50 checklist limit.</Note>
      )}
      {pending?.itemId && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.supporting, { color: c.textSecondary }]}
        >
          Saving checklist item…
        </Text>
      )}
      {displayed?.checklists.map((checklist) => (
        <ChecklistPanel
          key={checklist.id}
          checklist={checklist}
          open={open}
          pending={pending}
          mayEdit={mayEdit}
          canAdd={!needsReview}
          writeRetry={writeRetry}
          onToggle={(itemId, isChecked) =>
            void save(
              {
                kind: 'toggle',
                checklistId: checklist.id,
                itemId,
                isChecked,
              },
              false,
            )
          }
        />
      ))}
      {sheet && !hidden && !readOnly && context.active && (
        <BottomSheet
          visible
          showHandle
          respectReducedMotion
          dismissLabel={
            sheet.mode === 'form'
              ? 'Close checklist editor'
              : 'Close checklist options'
          }
          dismissible={!saving}
          onDismiss={dismiss}
          title={
            sheet.mode === 'form'
              ? discard
                ? 'Discard changes?'
                : sheet.action
              : sheet.mode === 'delete'
                ? sheet.target.itemId
                  ? 'Delete item?'
                  : 'Delete checklist?'
                : sheet.target.itemId
                  ? 'Item actions'
                  : 'Checklist actions'
          }
          footer={
            sheet.mode === 'form' && !discard ? (
              <View style={styles.actions}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  disabled={saving}
                  onPress={dismiss}
                />
                <Button
                  label="Save"
                  loading={saving}
                  disabled={
                    !mayEdit ||
                    !writeRetry ||
                    !!fieldError ||
                    !!staleForm ||
                    !!atFormLimit ||
                    uncertain
                  }
                  onPress={submit}
                />
              </View>
            ) : undefined
          }
        >
          {sheet.mode === 'form' && discard ? (
            <>
              <Note>Your unsaved text will be discarded.</Note>
              <Button
                label="Keep editing"
                variant="secondary"
                onPress={() => setDiscard(false)}
              />
              <Button
                label="Discard changes"
                variant="destructive"
                onPress={() => setSheet(null)}
              />
            </>
          ) : (
            <>
              {!mayEdit && !saving && !uncertain && (
                <Note>
                  Changes are unavailable until checklist access is verified.
                </Note>
              )}
              {error && !uncertain && (
                <Note issue>{writeError(error.value)}</Note>
              )}
              {sheet.mode === 'form' && (
                <>
                  <TextField
                    label={formIsItem ? 'Item text' : 'Checklist title'}
                    value={text}
                    onChangeText={setText}
                    autoFocus
                    autoCapitalize="sentences"
                    returnKeyType="done"
                    onSubmitEditing={submit}
                    editable={!saving}
                    error={text.length ? fieldError : undefined}
                    hint={`Up to ${formIsItem ? ITEM_LENGTH : TITLE_LENGTH} characters`}
                  />
                  {staleForm && (
                    <Note issue>
                      The original text changed. Close this editor and review
                      the current text.
                    </Note>
                  )}
                  {atFormLimit && (
                    <Note issue>
                      The checklist limit was reached while this editor was
                      open.
                    </Note>
                  )}
                  {sheet.target && !row && (
                    <Note issue>This checklist is no longer available.</Note>
                  )}
                  {uncertain && (
                    <>
                      <Note issue>
                        {needsReview
                          ? 'Couldn’t confirm the addition. Reload and review the checklist before adding it again. This draft won’t be resubmitted.'
                          : 'The latest checklists are loaded. Close this draft and review the list before adding again.'}
                      </Note>
                      <Button
                        label="Reload checklists"
                        variant="secondary"
                        disabled={!online || !readRetry || query.isFetching}
                        onPress={() => void review()}
                      />
                    </>
                  )}
                </>
              )}
              {sheet.mode === 'menu' &&
                row &&
                (!sheet.target.itemId || item) && (
                  <>
                    <Note>{item?.text ?? row.title}</Note>
                    <Button
                      label={item ? 'Edit item' : 'Rename checklist'}
                      variant="secondary"
                      disabled={!mayEdit || saving}
                      onPress={() =>
                        open({
                          mode: 'form',
                          action: item ? 'Edit item' : 'Rename checklist',
                          initial: item?.text ?? row.title,
                          target: sheet.target,
                        })
                      }
                    />
                    {placements.map(([placement, label]) => (
                      <Button
                        key={placement}
                        label={label}
                        variant="secondary"
                        disabled={
                          !mayEdit ||
                          saving ||
                          !writeRetry ||
                          !moveId ||
                          moveAnchor(moves, moveId, placement) === undefined
                        }
                        onPress={() =>
                          void save({
                            kind: 'place',
                            ...sheet.target,
                            placement,
                            shown: moves,
                          })
                        }
                      />
                    ))}
                    <Button
                      label={item ? 'Delete item' : 'Delete checklist'}
                      variant="link"
                      disabled={!mayEdit || saving}
                      onPress={() =>
                        open({ mode: 'delete', target: sheet.target })
                      }
                    />
                  </>
                )}
              {sheet.mode === 'delete' && (
                <>
                  <Note>
                    {sheet.target.itemId
                      ? 'This item will be permanently deleted.'
                      : 'This permanently deletes the checklist and all its items.'}
                  </Note>
                  <Button
                    label={
                      sheet.target.itemId ? 'Delete item' : 'Delete checklist'
                    }
                    variant="destructive"
                    loading={saving}
                    disabled={
                      !mayEdit ||
                      !writeRetry ||
                      !row ||
                      (!!sheet.target.itemId && !item)
                    }
                    onPress={() =>
                      void save(
                        sheet.target.itemId
                          ? {
                              kind: 'deleteItem',
                              checklistId: sheet.target.checklistId,
                              itemId: sheet.target.itemId,
                            }
                          : {
                              kind: 'delete',
                              checklistId: sheet.target.checklistId,
                            },
                      )
                    }
                  />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    disabled={saving}
                    onPress={dismiss}
                  />
                </>
              )}
              {sheet.mode !== 'form' &&
                (!row || (!!sheet.target.itemId && !item)) && (
                  <Note issue>This selection is no longer available.</Note>
                )}
              {query.isError && !uncertain && (
                <Button
                  label="Retry checklist data"
                  variant="secondary"
                  disabled={!online || !readRetry || saving || query.isFetching}
                  onPress={refresh}
                />
              )}
            </>
          )}
        </BottomSheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center' },
  number: { fontVariant: ['tabular-nums'] },
  icon: {
    width: 16,
    height: 16,
    borderWidth: 1,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 5,
    height: 9,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    transform: [{ rotate: '45deg' }],
  },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 3, height: 3, borderRadius: 2 },
});
