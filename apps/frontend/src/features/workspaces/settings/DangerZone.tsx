import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Dialog } from '../../../components/Dialog';
import { TextField } from '../../../components/TextField';
import { isApiError } from '../../../lib/api-client';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import {
  useDeleteWorkspace,
  useForgetWorkspace,
  useLeaveWorkspace,
} from './hooks';
import { SettingsPanel } from './WorkspaceSettingsLayout';

function leaveError(error: unknown): string {
  if (isApiError(error) && error.status === 409)
    return 'You are the last admin. Make another member an admin before you leave.';
  if (isApiError(error) && error.status === 403)
    return 'You cannot leave this workspace.';
  return 'Could not leave the workspace. Try again.';
}

function deleteError(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 409)
      return 'This workspace still has boards (active, archived or private ones you cannot see). Move or remove every board first, then try again.';
    if (error.status === 400)
      return 'The name does not match. Type the exact workspace name.';
    if (error.status === 403)
      return 'Only workspace admins can delete a team workspace.';
  }
  return 'Could not delete the workspace. Try again.';
}

const row =
  'flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between';

export function DangerZone() {
  const { workspaceId = '' } = useParams();
  const workspace = useWorkspacePage();
  const navigate = useNavigate();
  const forget = useForgetWorkspace(workspaceId);
  const leave = useLeaveWorkspace(workspaceId);
  const remove = useDeleteWorkspace(workspaceId);
  const [dialog, setDialog] = useState<'leave' | 'delete' | null>(null);
  const [typed, setTyped] = useState('');
  const summary = workspace.overview?.workspace;
  if (!summary) return null;
  const team = summary.type === 'TEAM';
  const admin = summary.role === 'ADMIN';
  const done = () => {
    // Leave the page first so nothing refetches the Workspace we just lost.
    void navigate('/workspaces', { replace: true });
    forget();
  };

  return (
    <SettingsPanel
      title="Danger Zone"
      description="These actions are permanent. Take care."
    >
      <div className="divide-y divide-line rounded-lg border border-danger/30 px-4 py-4">
        <div className={row}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Leave workspace</p>
            <p className="mt-1 text-sm text-muted">
              {team
                ? 'You lose access to this workspace. Boards you were added to directly stay shared with you.'
                : 'You cannot leave your personal workspace.'}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={!team}
            className="shrink-0 text-danger"
            onClick={() => {
              leave.reset();
              setDialog('leave');
            }}
          >
            Leave workspace
          </Button>
        </div>
        <div className={row}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Delete workspace</p>
            <p className="mt-1 text-sm text-muted">
              {!team
                ? 'A personal workspace cannot be deleted.'
                : !admin
                  ? 'Only workspace admins can delete a team workspace.'
                  : 'Only possible when the workspace has no boards at all, including archived ones. Boards, cards and people are never deleted with it.'}
            </p>
          </div>
          <Button
            variant="danger"
            disabled={!team || !admin}
            className="shrink-0"
            onClick={() => {
              remove.reset();
              setTyped('');
              setDialog('delete');
            }}
          >
            Delete workspace
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'leave'}
        title={`Leave “${summary.name}”?`}
        description="You will lose access to this workspace and its workspace-visible boards. Boards you were added to directly stay shared with you as a guest. To come back, an admin must invite you again."
        confirmLabel="Leave workspace"
        pendingLabel="Leaving…"
        pending={leave.isPending}
        error={leave.isError ? leaveError(leave.error) : undefined}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (!leave.isPending) leave.mutate(undefined, { onSuccess: done });
        }}
      />
      <Dialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        dismissible={!remove.isPending}
        title={`Delete “${summary.name}”?`}
        description="This removes the workspace, its members list and its invitations. It cannot be undone."
      >
        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed !== summary.name || remove.isPending) return;
            remove.mutate(typed, { onSuccess: done });
          }}
        >
          {remove.isError && (
            <Alert variant="error">{deleteError(remove.error)}</Alert>
          )}
          <TextField
            label={`Type ${summary.name} to confirm`}
            name="confirmationName"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            data-autofocus
          />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => setDialog(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={typed !== summary.name || remove.isPending}
            >
              {remove.isPending ? 'Deleting…' : 'Delete workspace'}
            </Button>
          </div>
        </form>
      </Dialog>
    </SettingsPanel>
  );
}
