import { BoardRole } from '@kanban/shared';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ActionMenu } from '../../../components/ActionMenu';
import { Alert } from '../../../components/Alert';
import { Button, buttonClassName } from '../../../components/Button';
import { ActivityIcon, UsersIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { PageHeader } from '../../../components/PageHeader';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { isApiError } from '../../../lib/api-client';
import { ActivityHistoryDialog } from '../../activities/components/ActivityHistoryDialog';
import { RealtimeStatus } from '../../realtime/components/RealtimeStatus';
import { useBoardRealtime } from '../../realtime/useBoardRealtime';
import { BoardPresence } from '../../presence/components/BoardPresence';
import { ArchiveBoardDialog } from '../components/ArchiveBoardDialog';
import { RestoreBoardDialog } from '../components/RestoreBoardDialog';
import { KanbanBoard } from '../components/KanbanBoard';
import { BoardIcon } from '../components/BoardIcon';
import { EditBoardDialog } from '../components/BoardFormDialog';
import { RoleChip } from '../components/RoleChip';
import { useVerifiedBoard } from '../useVerifiedBoard';
import { revokeBoardAccess } from '../revoke-board-access';
import type { BoardsLocationState } from './BoardsPage';
import { ArchivedCardsDialog } from '../../cards/components/ArchivedCardsDialog';
import { useBoardPolicyCapabilities } from '../../board-members/hooks';
import {
  BoardVisibilityDialog,
  MoveBoardDialog,
} from '../../workspaces/boards/BoardOwnerDialogs';
import {
  canUseBoardOwnerActions,
  type BoardOwnerActionModel,
} from '../../workspaces/boards/types';

/** 403 and 404 both mean "not available to you"; never reveal which. */
export function isBoardUnavailable(error: unknown): boolean {
  return isApiError(error) && [400, 403, 404].includes(error.status);
}

export function ArchivedBoardNotice() {
  return (
    <Alert variant="error">
      This board is archived. It can be viewed but no longer changed.
    </Alert>
  );
}

export function BoardUnavailable() {
  return (
    <EmptyState
      title="Board not found"
      description="It may have been archived, or you don't have access to it."
      action={
        <Link to="/boards" className={buttonClassName('secondary')}>
          Back to boards
        </Link>
      }
    />
  );
}

export function BoardDetailPage() {
  const { boardId = '' } = useParams();
  const navigate = useNavigate();
  const { board, verified } = useVerifiedBoard(boardId);
  const client = useQueryClient();
  const unavailable = board.isError && isBoardUnavailable(board.error);
  const realtime = useBoardRealtime(boardId, {
    enabled: verified && board.data !== undefined && !unavailable,
  });
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showingActivity, setShowingActivity] = useState(false);
  const [showingArchivedCards, setShowingArchivedCards] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [ownerAction, setOwnerAction] = useState<'visibility' | 'move' | null>(
    null,
  );
  const ownerBoard: BoardOwnerActionModel | undefined =
    verified && !unavailable && board.data?.workspaceId && board.data.visibility
      ? {
          ...board.data,
          workspaceId: board.data.workspaceId,
          visibility: board.data.visibility,
          canManageBoard: board.data.capabilities?.canManageBoard === true,
        }
      : undefined;
  const ownsActive = !!ownerBoard && canUseBoardOwnerActions(ownerBoard);
  const policy = useBoardPolicyCapabilities(boardId, ownsActive);
  const checkingAccess = !verified && !board.isError;
  usePageTitle(
    !unavailable && verified ? (board.data?.name ?? 'Board') : 'Board',
  );
  useEffect(() => {
    if (!unavailable) return;
    revokeBoardAccess(client, boardId);
  }, [unavailable, client, boardId]);

  if (board.isPending || checkingAccess) {
    return (
      <PageContainer>
        <LoadingState label="Loading board…" />
      </PageContainer>
    );
  }
  // Lost access (or the board is gone): never keep showing the cached board.
  if (unavailable) {
    return (
      <PageContainer>
        <BoardUnavailable />
      </PageContainer>
    );
  }
  // Any other failed background refresh keeps the board on screen (and open
  // dialogs intact).
  if (board.isError && (!board.data || !verified)) {
    return (
      <PageContainer>
        <ErrorState
          title="We couldn't load this board"
          description="Check your connection and try again."
          onRetry={() => void board.refetch()}
        />
      </PageContainer>
    );
  }

  const data = board.data!;
  // UI hint only: the backend enforces OWNER-only actions.
  const canManage =
    data.currentUserRole === BoardRole.OWNER && !data.isArchived;
  const readOnly =
    data.isArchived ||
    data.currentUserRole === null ||
    data.capabilities?.canWriteBoard === false;

  return (
    <PageContainer fill>
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <BoardIcon boardId={data.id} className="size-12 rounded-xl text-2xl" />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={data.name}
            description={data.description ?? undefined}
            actions={
              <>
                <BoardPresence
                  boardId={data.id}
                  canReadMembers={data.currentUserRole !== null}
                />
                <RealtimeStatus {...realtime} />
                <RoleChip role={data.currentUserRole} />
                <Button
                  variant="secondary"
                  onClick={() => setShowingActivity(true)}
                >
                  <ActivityIcon aria-hidden="true" className="size-4.5" />
                  Activity
                </Button>
                {data.currentUserRole !== null && (
                  <Link
                    to={`/boards/${data.id}/members`}
                    className={buttonClassName('secondary')}
                  >
                    <UsersIcon aria-hidden="true" className="size-4.5" />
                    Members
                  </Link>
                )}
                {
                  <ActionMenu
                    className="ml-auto"
                    label={`Actions for ${data.name}`}
                    items={[
                      {
                        label: 'Archived cards',
                        onSelect: () => setShowingArchivedCards(true),
                      },
                      ...(canManage
                        ? [
                            {
                              label: 'Edit board',
                              onSelect: () => setEditing(true),
                            },
                            ...(ownsActive
                              ? [
                                  {
                                    label: 'Change visibility',
                                    disabledReason: policy.isError
                                      ? 'Could not check workspace rules. Try again later.'
                                      : !policy.data
                                        ? 'Checking workspace rules…'
                                        : !policy.data.canChangeVisibility
                                          ? 'Workspace rules do not allow visibility changes.'
                                          : undefined,
                                    onSelect: () =>
                                      setOwnerAction('visibility'),
                                  },
                                  {
                                    label: 'Move to workspace',
                                    onSelect: () => setOwnerAction('move'),
                                  },
                                ]
                              : []),
                            {
                              label: 'Archive board',
                              onSelect: () => setArchiving(true),
                              tone: 'danger' as const,
                            },
                          ]
                        : []),
                      ...(data.isArchived &&
                      data.currentUserRole === BoardRole.OWNER
                        ? [
                            {
                              label: 'Restore board',
                              onSelect: () => setRestoring(true),
                            },
                          ]
                        : []),
                    ]}
                  />
                }
              </>
            }
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {notice && <Alert variant="success">{notice}</Alert>}
        {data.isArchived && <ArchivedBoardNotice />}
      </div>

      <div className="mt-5 min-h-0 flex-1 short:mt-3">
        <KanbanBoard
          boardId={data.id}
          readOnly={readOnly}
          canReadMembers={data.currentUserRole !== null}
        />
      </div>

      {showingArchivedCards && (
        <ArchivedCardsDialog
          boardId={data.id}
          readOnly={readOnly}
          onClose={() => setShowingArchivedCards(false)}
        />
      )}
      {showingActivity && (
        <ActivityHistoryDialog
          key={`${data.id}:${data.currentUserRole === null ? 'workspace' : 'member'}`}
          boardId={data.id}
          canReadMembers={data.currentUserRole !== null}
          open
          onClose={() => setShowingActivity(false)}
        />
      )}
      {canManage && editing && (
        <EditBoardDialog
          board={data}
          open
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            setNotice(`Board “${saved.name}” updated.`);
          }}
        />
      )}
      {ownsActive && ownerBoard && ownerAction === 'visibility' && (
        <BoardVisibilityDialog
          key={`${data.id}:${data.workspaceId}:${data.visibility}`}
          board={ownerBoard}
          onClose={() => setOwnerAction(null)}
          onSaved={() => setNotice('Board visibility updated.')}
        />
      )}
      {ownsActive && ownerBoard && ownerAction === 'move' && (
        <MoveBoardDialog
          key={`${data.id}:${data.workspaceId}`}
          board={ownerBoard}
          onClose={() => setOwnerAction(null)}
          onSaved={() =>
            setNotice(
              'Board moved. Its link and board memberships are unchanged; visibility is now Private.',
            )
          }
        />
      )}
      {canManage && archiving && (
        <ArchiveBoardDialog
          board={data}
          open
          onClose={() => setArchiving(false)}
          onArchived={(saved) => {
            const state: BoardsLocationState = {
              notice: `Board “${saved.name}” archived.`,
            };
            navigate('/boards', { replace: true, state });
          }}
        />
      )}
      {data.currentUserRole === BoardRole.OWNER && restoring && (
        <RestoreBoardDialog
          board={data}
          open
          onClose={() => setRestoring(false)}
          onRestored={(saved) => {
            setRestoring(false);
            setNotice(`Board “${saved.name}” restored.`);
          }}
        />
      )}
    </PageContainer>
  );
}
