import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../../../components/Button';
import type { WorkspaceSummary } from '../../workspaces/types';
import { workspacePath } from '../../workspaces/navigation';
import type { Board } from '../types';

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

export function BoardSettings({
  board,
  workspace,
  canManage,
  canRestore,
  canMove,
  canChangeVisibility,
  policyMessage,
  onEdit,
  onVisibility,
  onMove,
  onArchive,
  onRestore,
}: {
  board: Board;
  workspace?: WorkspaceSummary;
  canManage: boolean;
  canRestore: boolean;
  canMove: boolean;
  canChangeVisibility: boolean;
  policyMessage?: string;
  onEdit: () => void;
  onVisibility: () => void;
  onMove: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const visibility =
    board.visibility === 'PRIVATE'
      ? 'Private'
      : board.visibility === 'WORKSPACE_VISIBLE'
        ? 'Workspace visible'
        : 'Unavailable';
  return (
    <div className="mt-5 min-w-0 max-w-3xl space-y-4 pb-6">
      <section
        id="board-general"
        aria-labelledby="board-general-title"
        className="scroll-mt-4 rounded-xl border border-line bg-surface"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 id="board-general-title" className="text-base font-semibold">
            General
          </h2>
          {canManage && (
            <Button variant="secondary" onClick={onEdit}>
              Edit board
            </Button>
          )}
        </div>
        <dl className="divide-y divide-line px-4 sm:px-5">
          <SettingRow label="Board name">
            <span className="font-medium">{board.name}</span>
          </SettingRow>
          <SettingRow label="Description">
            <span
              className={
                board.description ? 'whitespace-pre-wrap' : 'text-muted italic'
              }
            >
              {board.description || 'No description added.'}
            </span>
          </SettingRow>
          <SettingRow label="Workspace">
            {workspace ? (
              <Link
                className="rounded font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                to={workspacePath(workspace.id)}
              >
                {workspace.name}
              </Link>
            ) : (
              <span className="text-muted">
                Workspace details are only available to its members.
              </span>
            )}
          </SettingRow>
          <SettingRow label="Status">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${board.isArchived ? 'bg-app text-muted' : 'bg-success/10 text-success'}`}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${board.isArchived ? 'bg-muted' : 'bg-success'}`}
              />
              {board.isArchived ? 'Archived' : 'Active'}
            </span>
          </SettingRow>
        </dl>
      </section>
      <section
        id="board-permissions"
        aria-labelledby="board-permissions-title"
        className="scroll-mt-4 rounded-xl border border-line bg-surface"
      >
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="board-permissions-title"
              className="text-base font-semibold"
            >
              Permissions
            </h2>
            <span
              className="rounded-full border border-line bg-app px-2.5 py-1 text-xs font-medium"
              aria-label={`Visibility: ${visibility}`}
            >
              {visibility}
            </span>
          </div>
          <p className="max-w-prose text-sm leading-relaxed text-muted">
            Private boards are accessible to board members. Workspace-visible
            boards can also be viewed by workspace members; editing requires
            board membership.
          </p>
          {canMove && (
            <div className="flex flex-col items-start gap-3 border-t border-line pt-3 sm:flex-row sm:items-center">
              <Button
                variant="secondary"
                disabled={!canChangeVisibility}
                aria-describedby={
                  policyMessage ? 'board-policy-message' : undefined
                }
                onClick={onVisibility}
              >
                Change visibility
              </Button>
              <Button variant="secondary" onClick={onMove}>
                Move to workspace
              </Button>
            </div>
          )}
          {policyMessage && (
            <p id="board-policy-message" className="text-sm text-muted">
              {policyMessage}
            </p>
          )}
        </div>
      </section>
      <section
        id="board-danger"
        aria-labelledby="board-danger-title"
        className="scroll-mt-4 rounded-xl border border-danger/30 bg-surface"
      >
        <h2
          id="board-danger-title"
          className="px-4 pt-4 text-base font-semibold text-danger sm:px-5 sm:pt-5"
        >
          Danger zone
        </h2>
        <div className="flex flex-col items-start gap-4 p-4 pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pb-5">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              {board.isArchived ? 'Restore this board' : 'Archive this board'}
            </h3>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
              {board.isArchived
                ? 'Restoring reopens this board for collaboration. Its cards and history are preserved.'
                : 'Archiving makes this board read-only. Cards and history are preserved, and an owner can restore it later.'}
            </p>
          </div>
          {canManage && (
            <Button
              variant="secondary"
              className="shrink-0 text-danger! hover:bg-danger/5"
              onClick={onArchive}
            >
              Archive board
            </Button>
          )}
          {canRestore && (
            <Button
              variant="secondary"
              className="shrink-0"
              onClick={onRestore}
            >
              Restore board
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
