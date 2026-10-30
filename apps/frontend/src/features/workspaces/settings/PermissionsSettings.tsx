import { useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard';
import { isApiError } from '../../../lib/api-client';
import { useAuthSession } from '../../auth/auth-session-context';
import { useAuth } from '../../auth/useAuth';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import { WorkspaceState } from '../components/WorkspaceState';
import type { WorkspaceViewState } from '../types';
import type { PolicyFields, WorkspacePolicy } from './api';
import { useUpdateWorkspacePolicy, useWorkspacePolicy } from './hooks';
import { SettingsPanel } from './WorkspaceSettingsLayout';

/** Only the four policies P2-05 supports; each choice is a true/false field. */
const POLICIES: {
  field: keyof PolicyFields;
  title: string;
  options: [value: boolean, label: string, hint: string][];
}[] = [
  {
    field: 'boardCreationAdminOnly',
    title: 'Who can create boards',
    options: [
      [
        false,
        'All members',
        'Any member can create or move boards into this workspace.',
      ],
      [
        true,
        'Admins only',
        'Existing boards stay; only admins can add new ones.',
      ],
    ],
  },
  {
    field: 'boardInvitesEnabled',
    title: 'Board owners can add board members',
    options: [
      [true, 'Allowed', 'Board owners add people to their own boards.'],
      [
        false,
        'Not allowed',
        'Owners cannot add anyone. Workspace membership is never given through a board.',
      ],
    ],
  },
  {
    field: 'boardMembershipChangesEnabled',
    title: 'Board owners can change board members',
    options: [
      [
        true,
        'Allowed',
        'Owners change roles and remove people on their boards.',
      ],
      [
        false,
        'Not allowed',
        'Current board members keep their access and roles.',
      ],
    ],
  },
  {
    field: 'boardVisibilityChangesEnabled',
    title: 'Board owners can change board visibility',
    options: [
      [
        true,
        'Allowed',
        'Owners can share a board read-only with the whole workspace.',
      ],
      [false, 'Not allowed', 'Each board keeps its current visibility.'],
    ],
  },
];

const fieldsOf = (policy: WorkspacePolicy): PolicyFields => ({
  boardCreationAdminOnly: policy.boardCreationAdminOnly,
  boardInvitesEnabled: policy.boardInvitesEnabled,
  boardMembershipChangesEnabled: policy.boardMembershipChangesEnabled,
  boardVisibilityChangesEnabled: policy.boardVisibilityChangesEnabled,
});

function saveError(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 403)
      return 'Only workspace admins can change permissions. Your role may have changed.';
    if (error.status === 409)
      return 'These permissions changed meanwhile. Your choices are kept; review and save again.';
  }
  return 'Could not save permissions. Your choices are kept; try again.';
}

export function PermissionsSettings() {
  const { workspaceId = '' } = useParams();
  const { user } = useAuth();
  const { generation } = useAuthSession();
  const workspace = useWorkspacePage();
  const policy = useWorkspacePolicy(workspaceId, workspace.state);
  const revoked =
    policy.state === 'forbidden' ||
    policy.state === 'not-found' ||
    policy.value?.canManagePolicies === false;
  return (
    <PolicyForm
      key={`${user?.id}:${generation}:${workspaceId}:${revoked}`}
      workspaceId={workspaceId}
      policy={policy.value}
      state={policy.state}
      fallback={
        workspace.state === 'ready' ? (
          <WorkspaceState
            state={policy.state}
            retry={() => void policy.refetch()}
          />
        ) : null
      }
    />
  );
}

function PolicyForm({
  workspaceId,
  policy,
  state,
  fallback,
}: {
  workspaceId: string;
  policy?: WorkspacePolicy;
  state: WorkspaceViewState;
  fallback: ReactNode;
}) {
  // Keep only local choices while authoritative reads are temporarily hidden.
  const [edits, setEdits] = useState<Partial<PolicyFields>>({});
  const [notice, setNotice] = useState<string>();
  const update = useUpdateWorkspacePolicy(workspaceId);
  if (state !== 'ready' || !policy) return fallback;
  const saved = fieldsOf(policy);
  const canEdit = policy.canManagePolicies;
  // Only fields that differ from the latest server values are sent.
  const changes = Object.fromEntries(
    Object.entries(canEdit ? edits : {}).filter(
      ([field, value]) => saved[field as keyof PolicyFields] !== value,
    ),
  ) as Partial<PolicyFields>;
  const dirty = canEdit && Object.keys(changes).length > 0;
  const value = { ...saved, ...changes };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || update.isPending) return;
    setNotice(undefined);
    update.mutate(changes, {
      onSuccess: () => {
        if (!update.isCurrent()) return;
        setEdits({});
        setNotice('Permissions saved.');
      },
    });
  };

  return (
    <SettingsPanel
      title="Permissions"
      description="Decide what board owners and members may do in this workspace."
    >
      <form noValidate onSubmit={submit} className="space-y-5">
        {!canEdit && (
          <p className="rounded-lg border border-line bg-app/50 px-3 py-2 text-sm text-muted">
            Only workspace admins can change permissions. These are the current
            rules.
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
        <div className="divide-y divide-line rounded-lg border border-line">
          {POLICIES.map((item) => {
            const current = item.options.find(
              ([option]) => option === value[item.field],
            );
            return (
              <fieldset
                key={item.field}
                disabled={!canEdit || update.isPending}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <legend className="float-left text-sm font-semibold text-ink">
                    {item.title}
                  </legend>
                  <p className="clear-left pt-0.5 text-xs leading-relaxed text-muted">
                    {current?.[2]}
                  </p>
                </div>
                {/* Two-option segmented control; each option is a real radio. */}
                <div className="inline-flex shrink-0 self-start rounded-lg border border-line bg-app/50 p-0.5 sm:self-center">
                  {item.options.map(([option, label]) => {
                    const checked = value[item.field] === option;
                    return (
                      <label
                        key={label}
                        className={`flex min-h-10 cursor-pointer items-center rounded-md px-3 text-sm whitespace-nowrap has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${checked ? 'bg-surface font-medium text-primary shadow-card' : 'text-muted hover:text-ink'}`}
                      >
                        <input
                          type="radio"
                          name={item.field}
                          checked={checked}
                          onChange={() =>
                            setEdits({ ...edits, [item.field]: option })
                          }
                          className="sr-only"
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
        <p className="text-xs leading-relaxed text-muted">
          These rules can only limit what board owners do. They never let a
          workspace admin open a private board, and a workspace-visible board is
          read-only for members who are not on it.
        </p>
        {canEdit && (
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              disabled={!dirty || update.isPending}
              onClick={() => {
                setEdits({});
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
        description="Your permission changes are not saved yet."
      />
    </SettingsPanel>
  );
}
