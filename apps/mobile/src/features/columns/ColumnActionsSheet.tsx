import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  BottomSheet,
  Button,
  TextField,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { useWorkspaceRetryReady } from '../workspaces/status';
import { columnMoveAnchor } from './mutations';
import {
  columnIssueMessage,
  type ColumnManagement,
} from './useColumnManagement';

export function ColumnActionsSheet({
  management,
  orderedColumnIds,
  orderReady,
}: {
  management: ColumnManagement;
  orderedColumnIds: readonly string[];
  orderReady: boolean;
}) {
  const c = useTheme();
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const { sheet, pending, failure, uncertain, dismiss } = management;
  const retryReady = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  if (!sheet || !management.available) return null;
  const editing = sheet.kind === 'create' || sheet.kind === 'rename';
  const currentName = sheet.kind === 'create' ? '' : sheet.column.name;
  const createdUncertain = sheet.kind === 'create' && uncertain;
  const blocked = pending || !retryReady;
  const title = discardPrompt
    ? 'Discard changes?'
    : sheet.kind === 'create'
      ? 'Add column'
      : sheet.kind === 'rename'
        ? 'Rename column'
        : sheet.kind === 'remove'
          ? `Delete “${currentName}”?`
          : currentName;

  return (
    <BottomSheet
      visible
      title={title}
      showHandle
      respectReducedMotion
      dismissible={!pending}
      onDismiss={() => {
        if (discardPrompt) setDiscardPrompt(false);
        else if (editing && !createdUncertain && sheet.draft !== currentName)
          setDiscardPrompt(true);
        else dismiss();
      }}
      dismissLabel="Dismiss column sheet"
    >
      {discardPrompt ? (
        <>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            Your changes will be lost.
          </Text>
          <Button
            label="Discard changes"
            variant="destructive"
            onPress={dismiss}
          />
          <Button
            label="Keep editing"
            variant="secondary"
            onPress={() => setDiscardPrompt(false)}
          />
        </>
      ) : (
        <>
          {editing && (
            <TextField
              label="Column name"
              autoFocus={!createdUncertain}
              autoCapitalize="sentences"
              editable={!pending}
              value={sheet.draft}
              onChangeText={management.edit}
            />
          )}
          {sheet.kind === 'remove' && (
            <Text style={[typography.body, { color: c.textSecondary }]}>
              This permanently removes the column for everyone on the board.
              Columns containing active or archived cards cannot be deleted.
            </Text>
          )}
          {(createdUncertain || failure) && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.danger }]}
            >
              {createdUncertain
                ? 'The server may have created this column. Check the refreshed board before creating again.'
                : columnIssueMessage(failure?.error)}
            </Text>
          )}
          {createdUncertain && (
            <>
              {!orderReady && (
                <Text
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
                  Load the latest columns before confirming.
                </Text>
              )}
              <Button
                label="Review board"
                variant="secondary"
                onPress={dismiss}
              />
              <Button
                label="I checked the board"
                variant="link"
                disabled={!orderReady}
                onPress={management.acknowledgeCreate}
              />
            </>
          )}
          {editing && !createdUncertain && (
            <Button
              label={sheet.kind === 'create' ? 'Create column' : 'Save column'}
              onPress={management.save}
              disabled={blocked}
              loading={pending}
            />
          )}
          {sheet.kind === 'actions' && (
            <>
              <Button
                label="Rename column"
                variant="secondary"
                disabled={blocked}
                onPress={() => management.openRename(sheet.column)}
              />
              <View style={{ gap: spacing.sm }}>
                {(['left', 'right'] as const).map((direction) => (
                  <Button
                    key={direction}
                    label={`Move ${direction}`}
                    variant="secondary"
                    disabled={
                      blocked ||
                      !orderReady ||
                      columnMoveAnchor(
                        orderedColumnIds,
                        sheet.column.id,
                        direction,
                      ) === undefined
                    }
                    onPress={() =>
                      void management.run({
                        kind: 'move',
                        id: sheet.column.id,
                        direction,
                      })
                    }
                  />
                ))}
                {!orderReady && (
                  <Text
                    style={[typography.supporting, { color: c.textSecondary }]}
                  >
                    Load the latest columns to move a column.
                  </Text>
                )}
              </View>
              <Button
                label="Delete column"
                variant="destructive"
                disabled={blocked}
                onPress={() => management.openRemove(sheet.column)}
              />
            </>
          )}
          {sheet.kind === 'remove' && (
            <Button
              label="Delete column"
              variant="destructive"
              disabled={blocked}
              loading={pending}
              onPress={() =>
                void management.run({ kind: 'remove', id: sheet.column.id })
              }
            />
          )}
          {pending && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.supporting, { color: c.textSecondary }]}
            >
              Saving column changes…
            </Text>
          )}
          <Button
            label="Cancel"
            variant="link"
            disabled={pending}
            onPress={dismiss}
          />
        </>
      )}
    </BottomSheet>
  );
}
