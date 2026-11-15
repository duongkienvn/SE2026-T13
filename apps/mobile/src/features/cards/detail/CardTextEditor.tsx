import { Text, View } from 'react-native';
import {
  Button,
  Surface,
  TextField,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { useWorkspaceRetryReady } from '../../workspaces/status';
import { cardActionMessage } from '../useCardLifecycle';
import { draftValue } from './draft';
import type { CardDraftController } from './useCardDraft';

export function CardTextEditor({
  editor,
  canEdit,
  onFocus,
}: {
  editor: CardDraftController;
  canEdit: boolean;
  onFocus: () => void;
}) {
  const c = useTheme();
  const retryReady = useWorkspaceRetryReady(
    editor.failure?.error,
    editor.failure?.at ?? 0,
  );
  const draft = editor.draft;
  if (!draft) return null;
  let validation: string | undefined;
  try {
    draftValue(draft);
  } catch (error) {
    validation = error instanceof Error ? error.message : 'Check this value.';
  }
  const blocked = !canEdit || editor.pending || !retryReady || !!validation;
  return (
    <Surface>
      <TextField
        label={draft.field === 'description' ? 'Description' : 'Card title'}
        value={draft.value}
        onChangeText={editor.edit}
        onFocus={onFocus}
        multiline
        autoFocus
        scrollEnabled={false}
        editable={canEdit && !editor.pending}
        textAlignVertical="top"
        style={{ minHeight: draft.field === 'description' ? 160 : 72 }}
        hint={
          draft.field === 'description'
            ? `${[...draft.value.trim()].length} / 2,000 characters · Plain text`
            : `${[...draft.value.trim()].length} / 120 characters`
        }
        error={validation}
      />
      {!canEdit && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.textSecondary }]}
        >
          Editing is unavailable. Your unsaved text is kept here until you
          cancel or leave.
        </Text>
      )}
      {!canEdit && (
        <Text selectable style={[typography.body, { color: c.text }]}>
          {draft.value}
        </Text>
      )}
      {editor.failure && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.danger }]}
        >
          {editor.failure.error instanceof Error &&
          !('kind' in editor.failure.error)
            ? editor.failure.error.message
            : cardActionMessage(editor.failure.error)}
        </Text>
      )}
      {editor.conflict && (
        <View style={{ gap: spacing.sm }}>
          <Text
            accessibilityRole="alert"
            style={[typography.body, { color: c.warning }]}
          >
            This field changed on another device. Load the latest version or
            explicitly save your text over it.
          </Text>
          <Button
            label="Load latest"
            variant="secondary"
            disabled={editor.pending}
            onPress={editor.loadLatest}
          />
          <Button
            label="Keep mine and save"
            disabled={blocked}
            loading={editor.pending}
            onPress={() => void editor.save(true)}
          />
        </View>
      )}
      {!editor.conflict && (
        <Button
          label={
            draft.field === 'description' ? 'Save description' : 'Save title'
          }
          disabled={blocked}
          loading={editor.pending}
          onPress={() => void editor.save()}
        />
      )}
      <Button
        label="Cancel"
        variant="link"
        disabled={editor.pending}
        onPress={editor.cancel}
      />
    </Surface>
  );
}
