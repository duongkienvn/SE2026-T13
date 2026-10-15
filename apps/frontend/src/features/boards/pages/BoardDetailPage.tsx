import { BoardRole } from '@kanban/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ActionMenu } from '../../../components/ActionMenu';
import { Alert } from '../../../components/Alert';
import { buttonClassName } from '../../../components/Button';
import { UsersIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { PageHeader } from '../../../components/PageHeader';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { isApiError } from '../../../lib/api-client';
import { ArchiveBoardDialog } from '../components/ArchiveBoardDialog';
import { BoardIcon } from '../components/BoardIcon';
import { EditBoardDialog } from '../components/BoardFormDialog';
import { RoleChip } from '../components/RoleChip';
import { useBoard } from '../hooks';
import type { BoardsLocationState } from './BoardsPage';

/** 403 and 404 both mean "not available to you"; never reveal which. */
export function isBoardUnavailable(error: unknown): boolean {
  return isApiError(error) && (error.status === 403 || error.status === 404);
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
  const board = useBoard(boardId);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [notice, setNotice] = useState<string>();
  usePageTitle(board.data?.name ?? 'Board');

  if (board.isPending) {
    return (
      <PageContainer>
        <LoadingState label="Loading board…" />
      </PageContainer>
    );
  }
  // A failed background refresh keeps the board on screen (and open dialogs intact).
  if (board.isError && !board.data) {
    return (
      <PageContainer>
        {isBoardUnavailable(board.error) ? (
          <BoardUnavailable />
        ) : (
          <ErrorState
            title="We couldn't load this board"
            description="Check your connection and try again."
            onRetry={() => void board.refetch()}
          />
        )}
      </PageContainer>
    );
  }

  const data = board.data!;
  // UI hint only: the backend enforces OWNER-only actions.
  const canManage =
    data.currentUserRole === BoardRole.OWNER && !data.isArchived;

  return (
    <PageContainer>
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <BoardIcon boardId={data.id} className="size-12 rounded-xl text-2xl" />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={data.name}
            description={data.description ?? undefined}
            actions={
              <>
                <RoleChip role={data.currentUserRole} />
                <Link
                  to={`/boards/${data.id}/members`}
                  className={buttonClassName('secondary')}
                >
                  <UsersIcon aria-hidden="true" className="size-4.5" />
                  Members
                </Link>
                {canManage && (
                  <ActionMenu
                    label={`Actions for ${data.name}`}
                    items={[
                      { label: 'Edit board', onSelect: () => setEditing(true) },
                      {
                        label: 'Archive board',
                        onSelect: () => setArchiving(true),
                        tone: 'danger',
                      },
                    ]}
                  />
                )}
              </>
            }
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {notice && <Alert variant="success">{notice}</Alert>}
        {data.isArchived && <ArchivedBoardNotice />}
      </div>

      <div className="mt-5">
        <EmptyState
          title="Columns and cards are coming soon"
          description="This board's Kanban workspace will be available in an upcoming release."
        />
      </div>

      {editing && (
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
      {archiving && (
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
    </PageContainer>
  );
}
