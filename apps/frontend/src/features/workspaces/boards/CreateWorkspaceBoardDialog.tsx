import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '../../../components/Dialog';
import { LockIcon } from '../../../components/icons';
import { BoardForm } from '../../boards/components/BoardFormDialog';
import type { WorkspaceSummary } from '../types';
import { useCreateWorkspaceBoard } from './hooks';

export function CreateWorkspaceBoardDialog({
  workspaceId,
  workspace,
  disabledReason,
  onClose,
}: {
  workspaceId: string;
  workspace?: WorkspaceSummary;
  disabledReason?: string;
  onClose: () => void;
}) {
  const create = useCreateWorkspaceBoard(workspaceId, !disabledReason);
  const navigate = useNavigate();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <Dialog
      open
      title="Create a new board"
      description="Give your team a clear place to plan and collaborate."
      onClose={onClose}
      dismissible={!create.isPending}
    >
      <div className="mb-5 flex min-w-0 items-start gap-3 rounded-xl border border-line bg-app/50 p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <LockIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
            {workspace?.name ?? 'Current workspace'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            New boards are private. Only authorized Board members can access
            them.
          </p>
        </div>
      </div>
      <BoardForm
        initial={{ name: '', description: null }}
        submitLabel="Create Board"
        pendingLabel="Creating…"
        pending={create.isPending}
        disabledReason={disabledReason}
        onCancel={onClose}
        onSubmit={async (input) => {
          const board = await create.mutateAsync(input);
          if (!mounted.current || !create.isCurrent()) return;
          onClose();
          void navigate(`/boards/${encodeURIComponent(board.id)}`);
        }}
      />
    </Dialog>
  );
}
