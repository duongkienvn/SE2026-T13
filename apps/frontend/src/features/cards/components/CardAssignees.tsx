import { useState } from 'react';
import { Alert } from '../../../components/Alert';
import { PlusIcon } from '../../../components/icons';
import { isApiError } from '../../../lib/api-client';
import { toFormErrors } from '../../../lib/form-errors';
import { UserAvatar } from '../../auth/components/UserAvatar';
import type { BoardMember } from '../../board-members/types';
import {
  BOARD_MEMBER_NOT_FOUND,
  CARD_ASSIGNEE_EXISTS,
  useAssignCard,
  useUnassignCard,
} from '../hooks';
import type { Card } from '../types';

interface CardAssigneesProps {
  card: Card;
  /** Everyone on the board: the only people a card can be assigned to. */
  members: BoardMember[];
  readOnly: boolean;
}

function assigneeError(error: unknown): string | undefined {
  if (!error) return undefined;
  if (isApiError(error) && error.code === CARD_ASSIGNEE_EXISTS) {
    return 'This person is already assigned.';
  }
  if (isApiError(error) && error.code === BOARD_MEMBER_NOT_FOUND) {
    return 'This person is no longer a member of the board.';
  }
  return toFormErrors(error, {}).formError;
}

export function CardAssignees({ card, members, readOnly }: CardAssigneesProps) {
  const assign = useAssignCard(card.boardId, card.id);
  const unassign = useUnassignCard(card.boardId, card.id);
  const [picking, setPicking] = useState(false);
  const busy = assign.isPending || unassign.isPending;
  const error = assigneeError(assign.error ?? unassign.error);

  const byId = new Map(members.map((member) => [member.user.id, member.user]));
  const assignedIds = new Set(card.assignees.map((a) => a.userId));
  const available = members.filter(
    (member) => !assignedIds.has(member.user.id),
  );

  const reset = () => {
    assign.reset();
    unassign.reset();
  };

  return (
    <section aria-labelledby={`assignees-${card.id}`} className="space-y-2">
      <h3 id={`assignees-${card.id}`} className="text-sm font-medium text-ink">
        Assignees
      </h3>
      {error && <Alert variant="error">{error}</Alert>}
      {card.assignees.length === 0 ? (
        <p className="text-sm text-muted">No one is assigned.</p>
      ) : (
        <ul className="space-y-1.5">
          {card.assignees.map(({ userId }) => {
            const user = byId.get(userId);
            const name = user?.displayName ?? 'Former member';
            return (
              <li key={userId} className="flex items-center gap-2.5">
                {user ? (
                  <UserAvatar user={user} className="size-7 text-[11px]" />
                ) : (
                  <span className="size-7 shrink-0 rounded-full bg-app" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {name}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    disabled={busy}
                    onClick={() => {
                      reset();
                      unassign.mutate(userId);
                    }}
                    className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-app hover:text-danger focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && available.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={picking}
            disabled={busy}
            onClick={() => setPicking((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            Add assignee
          </button>
          {picking && (
            <ul
              aria-label="Board members"
              className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1"
            >
              {available.map(({ user }) => (
                <li key={user.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      reset();
                      assign.mutate(user.id, {
                        onSuccess: () => setPicking(false),
                      });
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-app focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  >
                    <UserAvatar user={user} className="size-6 text-[10px]" />
                    <span className="truncate">
                      <span className="sr-only">Assign </span>
                      {user.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {busy && (
        <p role="status" className="text-[13px] text-muted">
          Saving…
        </p>
      )}
    </section>
  );
}
