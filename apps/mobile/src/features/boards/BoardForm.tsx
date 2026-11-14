import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { BoardBackgroundPresetId } from '@kanban/shared';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
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
import { createBoardApi, type BoardInput } from './api';

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
  const data = useMobileData();
  const c = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceId, setWorkspaceId] = useState(selected.id);
  const [preset, setPreset] = useState<BoardBackgroundPresetId | undefined>();
  const [discard, setDiscard] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const catalog = useQuery({
    queryKey: [...queryKeys.scope(identity), 'board-background-presets'],
    queryFn: ({ signal }) => createBoardApi(data.api, identity).catalog(signal),
  });
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
      blocked ||
      !choices.some((workspace) => workspace.id === workspaceId)
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await onSubmit({
        name: trimmed,
        workspaceId,
        description: description || null,
        ...(preset ? { backgroundPreset: preset } : {}),
      });
    } catch (cause) {
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
        <Text style={[typography.strong, { color: c.text }]}>Background</Text>
        {catalog.isPending && (
          <Text style={{ color: c.textSecondary }}>Loading backgrounds…</Text>
        )}
        {catalog.isError && (
          <Button
            label="Retry backgrounds"
            variant="secondary"
            onPress={() => void catalog.refetch()}
          />
        )}
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {catalog.data?.map((item) => (
            <Chip
              key={item.id}
              label={item.id}
              selected={preset === item.id}
              disabled={pending}
              onPress={() => setPreset(item.id)}
            />
          ))}
        </View>
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
            blocked ||
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
