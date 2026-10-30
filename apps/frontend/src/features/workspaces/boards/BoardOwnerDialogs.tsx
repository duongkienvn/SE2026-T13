import type { BoardVisibility } from '@kanban/shared';
import { useState } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { isApiError } from '../../../lib/api-client';
import { useBoardPolicyCapabilities } from '../../board-members/hooks';
import { useWorkspaceDirectory } from '../hooks';
import { canUseBoardOwnerActions, type BoardOwnerActionModel } from './types';

export interface OwnerCommandState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  submit: (value: string) => void;
}

function commandError(error: unknown, action: string): string {
  if (isApiError(error)) {
    if (error.status === 403)
      return `Workspace rules or your board role no longer allow you to ${action}.`;
    if (error.status === 409)
      return 'This board changed meanwhile (for example it was archived). Close and try again after refreshing.';
    if (error.status === 404)
      return 'This board is no longer available to you.';
  }
  return `Could not ${action}. Try again.`;
}

const choice =
  'flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary';

function requiresRecheck(error: unknown) {
  return isApiError(error) && [403, 404, 409].includes(error.status);
}

export function BoardVisibilityDialog({
  board,
  onClose,
  command: change,
}: {
  board: BoardOwnerActionModel;
  onClose: () => void;
  command: OwnerCommandState;
}) {
  const [value, setValue] = useState<BoardVisibility>(board.visibility);
  const policy = useBoardPolicyCapabilities(
    board.id,
    canUseBoardOwnerActions(board),
  );
  const allowed =
    canUseBoardOwnerActions(board) &&
    policy.isSuccess &&
    policy.isFetchedAfterMount &&
    !policy.isFetching &&
    policy.data.canChangeVisibility &&
    !requiresRecheck(change.error);
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
          change.submit(value);
        }}
      >
        {policy.isError && (
          <Alert variant="error">
            Could not check the workspace rules. Close and try again.
          </Alert>
        )}
        {policy.isSuccess && !policy.data.canChangeVisibility && (
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
        {value === 'PRIVATE' && board.visibility === 'WORKSPACE_VISIBLE' && (
          <p className="text-xs leading-relaxed text-muted">
            Workspace members who were not added to this board will lose their
            read-only access.
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
  onClose,
  command: move,
}: {
  board: BoardOwnerActionModel;
  onClose: () => void;
  command: OwnerCommandState;
}) {
  const directory = useWorkspaceDirectory();
  // Only joined Workspaces that let this account create Boards.
  const destinations = directory.workspaces.filter(
    (item) => item.id !== board.workspaceId && item.canCreateBoards,
  );
  const [target, setTarget] = useState('');
  const allowed =
    canUseBoardOwnerActions(board) &&
    directory.state === 'ready' &&
    !directory.isFetching &&
    destinations.some((item) => item.id === target) &&
    !requiresRecheck(move.error);
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
          if (!allowed || move.isPending) return;
          move.submit(target);
        }}
      >
        {move.isError && (
          <Alert variant="error">{commandError(move.error, 'move it')}</Alert>
        )}
        {directory.state !== 'ready' && directory.state !== 'loading' && (
          <Alert variant="error">
            Could not load your joined workspaces. Close and try again.
          </Alert>
        )}
        {directory.state === 'ready' && !destinations.length && (
          <p className="text-sm text-muted">
            No eligible destination workspace. Join another workspace that
            allows you to create boards, then try again.
          </p>
        )}
        <label className="block">
          <span className="text-sm font-medium text-ink">
            Destination workspace
          </span>
          <select
            value={target}
            disabled={
              move.isPending ||
              directory.state !== 'ready' ||
              !destinations.length
            }
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
          <Button type="submit" disabled={!allowed || move.isPending}>
            {move.isPending ? 'Moving…' : 'Move board'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
