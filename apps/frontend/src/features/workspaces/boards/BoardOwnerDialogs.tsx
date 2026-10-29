import type { BoardVisibility } from '@kanban/shared';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { ApiError, isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { useBoardPolicyCapabilities } from '../../board-members/hooks';
import { boardKeys } from '../../boards/query-keys';
import { revokeBoardAccess } from '../../boards/revoke-board-access';
import { useWorkspaceDirectory } from '../hooks';
import { workspaceKeys } from '../query-keys';
import { changeBoardVisibility, moveBoardToWorkspace } from '../settings/api';
import type { WorkspaceBoardSummary } from './types';

/** Board OWNER commands; success only after the server confirms. */
function useOwnerCommand<Input>(
  board: WorkspaceBoardSummary,
  run: (token: string, input: Input) => Promise<unknown>,
) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (input: Input) => {
      if (board.currentUserRole !== 'OWNER' || !scope.isCurrent())
        throw new ApiError(403, 'FORBIDDEN', 'Board action unavailable.');
      return runAuthorized((token) => run(token, input));
    },
    onSettled: (_data, error) => {
      if (!scope.isCurrent()) return;
      if (isApiError(error) && error.status === 404)
        revokeBoardAccess(client, board.id);
      // Old and new Workspace lists, Overview counts and Board pages.
      void client.invalidateQueries({
        queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
      });
      void client.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}

function commandError(error: unknown, action: string): string {
  if (isApiError(error)) {
    if (error.status === 403)
      return `Workspace rules or your board role no longer allow you to ${action}.`;
    if (error.status === 409)
      return 'This board changed meanwhile (for example it was archived). The list has been refreshed.';
    if (error.status === 404)
      return 'This board is no longer available to you.';
  }
  return `Could not ${action}. Try again.`;
}

const choice =
  'flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary';

export function BoardVisibilityDialog({
  board,
  onClose,
}: {
  board: WorkspaceBoardSummary;
  onClose: () => void;
}) {
  const [value, setValue] = useState<BoardVisibility>(board.visibility);
  const policy = useBoardPolicyCapabilities(board.id, true);
  const change = useOwnerCommand(board, (token, visibility: BoardVisibility) =>
    changeBoardVisibility(token, board.id, visibility),
  );
  const allowed = policy.data?.canChangeVisibility === true;
  const widening =
    value === 'WORKSPACE_VISIBLE' && board.visibility === 'PRIVATE';
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!change.isPending}
      title="Board visibility"
      description={`Choose who can see “${board.name}”.`}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!allowed || value === board.visibility || change.isPending)
            return;
          change.mutate(value, { onSuccess: onClose });
        }}
      >
        {policy.isError && (
          <Alert variant="error">
            Could not check the workspace rules. Close and try again.
          </Alert>
        )}
        {policy.data && !allowed && (
          <Alert variant="error">
            This workspace does not let board owners change visibility.
          </Alert>
        )}
        {change.isError && (
          <Alert variant="error">
            {commandError(change.error, 'change visibility')}
          </Alert>
        )}
        <fieldset className="space-y-2" disabled={!allowed || change.isPending}>
          <legend className="sr-only">Visibility</legend>
          {(
            [
              [
                'PRIVATE',
                'Private',
                'Only people added to this board can open it.',
              ],
              [
                'WORKSPACE_VISIBLE',
                'Workspace',
                'Every workspace member can open it read-only. Only board members can edit.',
              ],
            ] as const
          ).map(([option, label, hint]) => (
            <label
              key={option}
              className={`${choice} ${value === option ? 'border-primary bg-primary-soft/40' : 'border-line'}`}
            >
              <input
                type="radio"
                name="visibility"
                checked={value === option}
                onChange={() => setValue(option)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
              />
              <span>
                <span className="block text-sm font-medium text-ink">
                  {label}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {widening && (
          <p className="text-xs leading-relaxed text-muted">
            Everyone in this workspace will be able to read this board&apos;s
            columns, cards and comments.
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            disabled={change.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              !allowed || value === board.visibility || change.isPending
            }
          >
            {change.isPending
              ? 'Saving…'
              : widening
                ? 'Share with workspace'
                : 'Save visibility'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function MoveBoardDialog({
  board,
  workspaceId,
  onClose,
}: {
  board: WorkspaceBoardSummary;
  workspaceId: string;
  onClose: () => void;
}) {
  const directory = useWorkspaceDirectory();
  // Only joined Workspaces that let this account create Boards.
  const destinations = directory.workspaces.filter(
    (item) => item.id !== workspaceId && item.canCreateBoards,
  );
  const [target, setTarget] = useState('');
  const move = useOwnerCommand(board, (token, destination: string) =>
    moveBoardToWorkspace(token, board.id, destination),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!move.isPending}
      title="Move board"
      description={`Move “${board.name}” to another workspace.`}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!target || move.isPending) return;
          move.mutate(target, { onSuccess: onClose });
        }}
      >
        {move.isError && (
          <Alert variant="error">{commandError(move.error, 'move it')}</Alert>
        )}
        <label className="block">
          <span className="text-sm font-medium text-ink">
            Destination workspace
          </span>
          <select
            value={target}
            disabled={move.isPending || directory.state !== 'ready'}
            onChange={(event) => setTarget(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted"
          >
            <option value="">
              {directory.state === 'loading'
                ? 'Loading workspaces…'
                : destinations.length
                  ? 'Choose a workspace'
                  : 'No other workspace allows you to add boards'}
            </option>
            {destinations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.type === 'PERSONAL' ? ' (Personal)' : ''}
              </option>
            ))}
          </select>
        </label>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted">
          <li>The board link stays the same.</li>
          <li>People added to the board keep their access.</li>
          <li>Visibility resets to Private.</li>
        </ul>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            disabled={move.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!target || move.isPending}>
            {move.isPending ? 'Moving…' : 'Move board'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
