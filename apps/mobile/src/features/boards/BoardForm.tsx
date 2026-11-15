import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { BoardBackgroundPresetId } from '@kanban/shared';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { ApiError } from '../../infrastructure/api/errors';
import {
  BottomSheet,
  Button,
  Chip,
  TextField,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import type { WorkspaceSummary } from '../workspaces/decoder';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
} from '../workspaces/status';
import type { BoardInput } from './api';
import { BackgroundPicker } from './BackgroundPicker';

export function BoardForm({
  identity,
  selected,
  workspaces,
  onDismiss,
  onSubmit,
  blocked,
  onConfirmChecked,
}: {
  identity: SessionIdentity;
  selected: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  onDismiss: () => void;
  onSubmit: (input: BoardInput) => Promise<void>;
  blocked: boolean;
  onConfirmChecked: () => void;
}) {
  const c = useTheme();
  const online = useWorkspaceOnline();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceId, setWorkspaceId] = useState(selected.id);
  const [preset, setPreset] = useState<BoardBackgroundPresetId | undefined>();
  const [discard, setDiscard] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<{
    error: ApiError;
    at: number;
  } | null>(null);
  const retryReady = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  const busy = useRef(false);
  const choices = workspaces.filter((workspace) => workspace.canCreateBoards);
  const dirty =
    !!name || !!description || !!preset || workspaceId !== selected.id;
  const close = () => {
    if (!busy.current) {
      if (dirty) setDiscard(true);
      else onDismiss();
    }
  };
  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120 || description.length > 2000) {
      setError(
        'Enter a name of 1–120 characters and a description of at most 2000 characters.',
      );
      return;
    }
    if (
      busy.current ||
      !online ||
      blocked ||
      !canRetryWorkspace(failure?.error, failure?.at ?? 0) ||
      !choices.some((workspace) => workspace.id === workspaceId)
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    setFailure(null);
    try {
      await onSubmit({
        name: trimmed,
        workspaceId,
        description: description || null,
        ...(preset ? { backgroundPreset: preset } : {}),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.cause instanceof ApiError)
        setFailure({ error: cause.cause, at: Date.now() });
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not create board. Try again.',
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <BottomSheet
        visible
        title="Create board"
        onDismiss={close}
        dismissible={!pending}
        showHandle
        respectReducedMotion
      >
        <TextField
          label="Board name"
          value={name}
          onChangeText={setName}
          maxLength={120}
          editable={!pending}
        />
        <TextField
          label="Board description (optional)"
          value={description}
          onChangeText={setDescription}
          maxLength={2000}
          multiline
          editable={!pending}
        />
        <Text style={[typography.strong, { color: c.text }]}>Workspace</Text>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {choices.map((workspace) => (
            <Chip
              key={workspace.id}
              label={workspace.name}
              selected={workspaceId === workspace.id}
              disabled={pending}
              onPress={() => setWorkspaceId(workspace.id)}
            />
          ))}
        </View>
        <BackgroundPicker
          identity={identity}
          value={preset}
          onChange={setPreset}
          disabled={pending || !online}
        />
        {!!error && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.danger }]}
          >
            {error}
          </Text>
        )}
        {blocked && (
          <>
            <Text accessibilityLiveRegion="polite" style={{ color: c.danger }}>
              The previous result is uncertain. Check the board list before
              retrying to avoid duplicates.
            </Text>
            <Button
              label="I've checked the board list"
              variant="secondary"
              onPress={onConfirmChecked}
            />
          </>
        )}
        <Button
          label="Create board"
          onPress={() => void submit()}
          loading={pending}
          disabled={
            pending ||
            !online ||
            blocked ||
            !retryReady ||
            !choices.some((workspace) => workspace.id === workspaceId)
          }
        />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={close}
          disabled={pending}
        />
      </BottomSheet>
      <UnsavedChangesPrompt
        visible={discard}
        onDiscard={onDismiss}
        onKeepEditing={() => setDiscard(false)}
      />
    </>
  );
}
