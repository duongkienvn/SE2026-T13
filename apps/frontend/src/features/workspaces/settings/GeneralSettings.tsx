import { useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { TextAreaField } from '../../../components/TextAreaField';
import { TextField } from '../../../components/TextField';
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard';
import { isApiError } from '../../../lib/api-client';
import { useAuthSession } from '../../auth/auth-session-context';
import { useAuth } from '../../auth/useAuth';
import { WorkspaceAvatar } from '../components/WorkspaceIdentity';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import { WorkspaceState } from '../components/WorkspaceState';
import type { WorkspaceResponse } from '../response';
import type { WorkspaceViewState } from '../types';
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
  const { user } = useAuth();
  const { generation } = useAuthSession();
  const workspace = useWorkspacePage();
  const detail = useWorkspaceDetail(workspaceId, workspace.state);
  const revoked =
    detail.state === 'forbidden' ||
    detail.state === 'not-found' ||
    detail.value?.canManage === false;
  return (
    <GeneralForm
      key={`${user?.id}:${generation}:${workspaceId}:${revoked}`}
      workspaceId={workspaceId}
      workspace={detail.value}
      state={detail.state}
      fallback={
        workspace.state === 'ready' ? (
          <WorkspaceState
            state={detail.state}
            retry={() => void detail.refetch()}
          />
        ) : null
      }
    />
  );
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

function GeneralForm({
  workspaceId,
  workspace,
  state,
  fallback,
}: {
  workspaceId: string;
  workspace?: WorkspaceResponse;
  state: WorkspaceViewState;
  fallback: ReactNode;
}) {
  // This session/Workspace owner stays mounted while protected reads revalidate.
  const [edits, setEdits] = useState<Partial<WorkspaceMetadataInput>>({});
  const [nameError, setNameError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const update = useUpdateWorkspace(workspaceId);
  if (state !== 'ready' || !workspace) return fallback;
  const saved = toInput(workspace);
  const canEdit = workspace.canManage;
  // Untouched fields always come from the latest authoritative response.
  const draft = { ...saved, ...(canEdit ? edits : {}) };
  const name = draft.name.trim();
  const description = (draft.description ?? '').trim();
  const changes: Partial<WorkspaceMetadataInput> = {};
  if ('name' in edits && name !== saved.name) changes.name = name;
  if ('description' in edits && description !== (saved.description ?? ''))
    changes.description = description || null;
  if ('icon' in edits && draft.icon !== saved.icon) changes.icon = draft.icon;
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
        if (!update.isCurrent()) return;
        // Do not discard newer input typed while this request was pending.
        setEdits((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([field, value]) =>
                edits[field as keyof WorkspaceMetadataInput] !== value,
            ),
          ),
        );
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
            setEdits({ ...edits, name: event.target.value });
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
            setEdits({ ...edits, description: event.target.value })
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
                    onClick={() => setEdits({ ...edits, icon })}
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
                setEdits({});
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
