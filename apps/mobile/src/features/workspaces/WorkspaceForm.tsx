import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Chip,
  ConfirmDialog,
  TextField,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import type { WorkspaceInput } from './api';
import type { WorkspaceSummary } from './decoder';
import { ApiError } from '../../infrastructure/api/errors';
import { canRetryWorkspace, useWorkspaceRetryReady } from './status';
import { WorkspaceGlyph } from './WorkspaceGlyph';

const icons = ['briefcase', 'users', 'code', 'palette', 'layers'] as const;

export type WorkspaceDraft = {
  initial: WorkspaceSummary;
  name: string;
  description: string;
  icon: WorkspaceSummary['icon'];
};

export function WorkspaceForm({
  workspace,
  onDismiss,
  onSubmit,
  blocked = false,
  onRetryLookup,
  onConfirmChecked,
  draft,
  onDraftChange,
}: {
  workspace?: WorkspaceSummary;
  onDismiss: () => void;
  onSubmit: (input: Partial<WorkspaceInput>) => Promise<void>;
  blocked?: boolean;
  onRetryLookup?: () => Promise<void>;
  onConfirmChecked?: () => void;
  draft?: WorkspaceDraft;
  onDraftChange?: (draft: WorkspaceDraft) => void;
}) {
  const c = useTheme();
  const [initial] = useState(draft?.initial ?? workspace);
  const [name, setName] = useState(draft?.name ?? workspace?.name ?? '');
  const [description, setDescription] = useState(
    draft?.description ?? workspace?.description ?? '',
  );
  const [icon, setIcon] = useState<WorkspaceSummary['icon']>(
    draft ? draft.icon : (workspace?.icon ?? null),
  );
  function rememberDraft(next: {
    name: string;
    description: string;
    icon: WorkspaceSummary['icon'];
  }) {
    if (initial) onDraftChange?.({ initial, ...next });
  }
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<{
    error: ApiError;
    at: number;
  } | null>(null);
  const retryReady = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const busy = useRef(false);
  const dirty =
    name !== (initial?.name ?? '') ||
    description !== (initial?.description ?? '') ||
    icon !== (initial?.icon ?? null);
  const close = () => {
    if (busy.current) return;
    if (dirty) setDiscard(true);
    else onDismiss();
  };
  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120 || description.trim().length > 2000) {
      setError(
        'Enter a name of 1–120 characters and a description of at most 2000 characters.',
      );
      return;
    }
    if (
      busy.current ||
      blocked ||
      !canRetryWorkspace(failure?.error, failure?.at ?? 0)
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    setFailure(null);
    try {
      await onSubmit({
        ...(!initial || name !== initial.name ? { name: trimmed } : {}),
        ...(!initial || description !== (initial.description ?? '')
          ? { description: description.trim() || null }
          : {}),
        ...(!initial || icon !== initial.icon ? { icon } : {}),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.cause instanceof ApiError)
        setFailure({ error: cause.cause, at: Date.now() });
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save workspace. Try again.',
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function retryLookup() {
    if (
      busy.current ||
      !onRetryLookup ||
      !canRetryWorkspace(failure?.error, failure?.at ?? 0)
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await onRetryLookup();
    } catch (cause) {
      if (cause instanceof ApiError)
        setFailure({ error: cause, at: Date.now() });
      setError(
        'Could not verify the created workspace. Check the list and try again.',
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
        title={workspace ? 'Edit workspace' : 'Create Team Workspace'}
        onDismiss={close}
        dismissible={!pending}
        showHandle
        respectReducedMotion
      >
        <TextField
          label="Name"
          value={name}
          onChangeText={(value) => {
            setName(value);
            rememberDraft({ name: value, description, icon });
          }}
          maxLength={120}
          editable={!pending}
        />
        <TextField
          label="Description (optional)"
          value={description}
          onChangeText={(value) => {
            setDescription(value);
            rememberDraft({ name, description: value, icon });
          }}
          maxLength={2000}
          multiline
          editable={!pending}
        />
        <Text style={[typography.strong, { color: c.text }]}>Icon</Text>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          <Chip
            label="None"
            selected={icon === null}
            disabled={pending}
            onPress={() => {
              setIcon(null);
              rememberDraft({ name, description, icon: null });
            }}
          />
          {icons.map((value) => (
            <View
              key={value}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
              }}
            >
              <WorkspaceGlyph icon={value} decorative />
              <Chip
                label={value}
                selected={icon === value}
                disabled={pending}
                onPress={() => {
                  setIcon(value);
                  rememberDraft({ name, description, icon: value });
                }}
              />
            </View>
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
        {blocked && !error && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.danger }]}
          >
            A previous creation could not be confirmed. Check your workspace
            list before trying again.
          </Text>
        )}
        <Button
          label={workspace ? 'Save changes' : 'Create workspace'}
          onPress={() => void submit()}
          loading={pending}
          disabled={blocked || !retryReady || (!!workspace && !dirty)}
        />
        {blocked && onRetryLookup && (
          <Button
            label="Retry workspace lookup"
            variant="secondary"
            loading={pending}
            disabled={!retryReady}
            onPress={() => void retryLookup()}
          />
        )}
        {blocked && !onRetryLookup && onConfirmChecked && (
          <Button
            label="I've checked the workspace list"
            variant="secondary"
            disabled={pending}
            onPress={() => setConfirmChecked(true)}
          />
        )}
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
      <ConfirmDialog
        visible={confirmChecked}
        title="Try creating again?"
        message="The earlier request may have succeeded. Check the workspace list first; trying again could create a duplicate."
        confirmLabel="I've checked, allow retry"
        onConfirm={() => {
          setConfirmChecked(false);
          onConfirmChecked?.();
        }}
        onCancel={() => setConfirmChecked(false)}
      />
    </>
  );
}
