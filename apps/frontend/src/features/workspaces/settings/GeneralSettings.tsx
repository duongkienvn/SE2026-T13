import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { TextAreaField } from '../../../components/TextAreaField';
import { TextField } from '../../../components/TextField';
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard';
import { isApiError } from '../../../lib/api-client';
import { WorkspaceAvatar } from '../components/WorkspaceIdentity';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import { WorkspaceState } from '../components/WorkspaceState';
import type { WorkspaceResponse } from '../response';
import {
  WORKSPACE_ICONS,
  type WorkspaceIcon,
  type WorkspaceMetadataInput,
} from './api';
import { useUpdateWorkspace, useWorkspaceDetail } from './hooks';
import { WORKSPACE_ICON_LABELS, WorkspaceIconGlyph } from './icons';
import { SettingsPanel } from './WorkspaceSettingsLayout';

export function GeneralSettings() {
  const { workspaceId = '' } = useParams();
  const workspace = useWorkspacePage();
  const detail = useWorkspaceDetail(workspaceId, workspace.state);
  if (detail.state !== 'ready' || !detail.value)
    return workspace.state === 'ready' ? (
      <WorkspaceState
        state={detail.state}
        retry={() => void detail.refetch()}
      />
    ) : null;
  return <GeneralForm key={workspaceId} workspace={detail.value} />;
}

function toInput(workspace: WorkspaceResponse): WorkspaceMetadataInput {
  return {
    name: workspace.name,
    description: workspace.description,
    icon: workspace.icon,
  };
}

function saveError(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 403)
      return 'Only workspace admins can change these settings. Your role may have changed.';
    if (error.status === 409)
      return 'Someone else changed this workspace. Your edits are kept; review and save again.';
    if (error.status === 400)
      return 'Check the name and description, then try again.';
  }
  return 'Could not save. Your edits are kept; check your connection and try again.';
}

function GeneralForm({ workspace }: { workspace: WorkspaceResponse }) {
  const saved = toInput(workspace);
  // Untouched fields follow the server; edits survive background refetches.
  const [edits, setDraft] = useState<WorkspaceMetadataInput | null>(null);
  const draft = edits ?? saved;
  const [nameError, setNameError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const update = useUpdateWorkspace(workspace.id);
  const canEdit = workspace.canManage;
  const name = draft.name.trim();
  const description = (draft.description ?? '').trim();
  const changes: Partial<WorkspaceMetadataInput> = {};
  if (name !== saved.name) changes.name = name;
  if (description !== (saved.description ?? ''))
    changes.description = description || null;
  if (draft.icon !== saved.icon) changes.icon = draft.icon;
  const dirty = canEdit && Object.keys(changes).length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || update.isPending) return;
    if (!name) {
      setNameError('Enter a workspace name.');
      return;
    }
    setNotice(undefined);
    update.mutate(changes, {
      onSuccess: () => {
        setDraft(null);
        setNotice('Workspace settings saved.');
      },
    });
  };

  return (
    <SettingsPanel
      title="General"
      description="Basic information about your workspace."
    >
      <form noValidate onSubmit={submit} className="space-y-5">
        {!canEdit && (
          <p className="rounded-lg border border-line bg-app/50 px-3 py-2 text-sm text-muted">
            Only workspace admins can change these settings. You can view them.
          </p>
        )}
        {notice && !update.isError && (
          <Alert variant="success">
            <span role="status">{notice}</span>
          </Alert>
        )}
        {update.isError && (
          <Alert variant="error">{saveError(update.error)}</Alert>
        )}
        <TextField
          label="Workspace name"
          name="name"
          value={draft.name}
          maxLength={120}
          readOnly={!canEdit}
          error={nameError}
          onChange={(event) => {
            setNameError(undefined);
            setDraft({ ...draft, name: event.target.value });
          }}
        />
        <TextAreaField
          label="Description"
          name="description"
          rows={3}
          maxLength={2000}
          readOnly={!canEdit}
          value={draft.description ?? ''}
          hint={canEdit ? 'Optional. Up to 2,000 characters.' : undefined}
          onChange={(event) =>
            setDraft({ ...draft, description: event.target.value })
          }
        />
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            Workspace icon
          </legend>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <WorkspaceAvatar
              workspace={{ ...workspace, icon: draft.icon }}
              className="size-14 text-xl"
            />
            <div
              role="radiogroup"
              aria-label="Workspace icon"
              className="flex flex-wrap gap-2"
            >
              {[null, ...WORKSPACE_ICONS].map((icon: WorkspaceIcon | null) => {
                const selected = draft.icon === icon;
                const label = icon ? WORKSPACE_ICON_LABELS[icon] : 'Initial';
                return (
                  <button
                    key={icon ?? 'initial'}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={label}
                    title={label}
                    disabled={!canEdit}
                    onClick={() => setDraft({ ...draft, icon })}
                    className={`grid size-11 place-items-center rounded-lg border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed ${selected ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:text-ink disabled:hover:text-muted'}`}
                  >
                    {icon ? (
                      <WorkspaceIconGlyph icon={icon} className="size-5" />
                    ) : (
                      workspace.name.trim().slice(0, 1).toLocaleUpperCase()
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>
        <p className="text-xs text-muted">
          Type:{' '}
          <span className="font-medium text-ink">
            {workspace.type === 'PERSONAL'
              ? 'Personal workspace'
              : 'Team workspace'}
          </span>
          . The type cannot be changed.
        </p>
        {canEdit && (
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              disabled={!dirty || update.isPending}
              onClick={() => {
                setDraft(null);
                setNameError(undefined);
                update.reset();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!dirty || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        )}
      </form>
      <UnsavedChangesGuard
        when={dirty}
        description="Your workspace name, description or icon changes are not saved yet."
      />
    </SettingsPanel>
  );
}
