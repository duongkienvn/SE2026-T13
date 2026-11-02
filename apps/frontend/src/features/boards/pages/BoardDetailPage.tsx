import { BoardRole } from '@kanban/shared';
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  useBlocker,
  useMatch,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import type { WorkspaceSummary } from '../../workspaces/types';
import { workspacePath } from '../../workspaces/navigation';
import { ActionMenu } from '../../../components/ActionMenu';
import { Alert } from '../../../components/Alert';
import { buttonClassName } from '../../../components/Button';
import { PageContainer } from '../../../components/PageContainer';
import { TextField } from '../../../components/TextField';
import { BoardNavigation } from '../components/BoardNavigation';
import { BoardSettings } from '../components/BoardSettings';
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
import {
  useBoardMembers,
  useBoardPolicyCapabilities,
} from '../../board-members/hooks';
import { useBoardOwnerActions } from '../../workspaces/boards/useBoardOwnerActions';
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

function BoardEditNavigationGuard({ onDiscard }: { onDiscard: () => void }) {
  const blocker = useBlocker(true);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Discard unsaved board changes?')) {
      onDiscard();
      blocker.proceed();
    } else blocker.reset();
  }, [blocker, onDiscard]);
  return null;
}

export function BoardDetailPage() {
  const workspace = useOutletContext<WorkspaceSummary | undefined>();
  const { boardId = '' } = useParams();
  const navigate = useNavigate();
  const settings = useMatch('/boards/:boardId/settings') !== null;
  const membersPage = useMatch('/boards/:boardId/members') !== null;
  const { board, verified } = useVerifiedBoard(boardId);
  const client = useQueryClient();
  // Observe roster refusals without loading the roster or mounting Kanban.
  const members = useBoardMembers(boardId, { enabled: false });
  const unavailable =
    (board.isError && isBoardUnavailable(board.error)) ||
    (members.isError && isBoardUnavailable(members.error));
  const realtime = useBoardRealtime(boardId, {
    enabled: verified && board.data !== undefined && !unavailable,
  });
  const [editing, setEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const closeEditor = useCallback(() => {
    setEditing(false);
    setEditDirty(false);
  }, []);
  const [archiving, setArchiving] = useState(false);
  const [showingActivity, setShowingActivity] = useState(false);
  const [showingArchivedCards, setShowingArchivedCards] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'fallback'>(
    'idle',
  );
  const boardUrl = `${window.location.origin}/boards/${encodeURIComponent(boardId)}`;
  const copyBoardLink = async () => {
    setCopyStatus('idle');
    try {
      if (!window.isSecureContext || !navigator.clipboard?.writeText) {
        setCopyStatus('fallback');
        return;
      }
      await navigator.clipboard.writeText(boardUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('fallback');
    }
  };
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
  const ownerActions = useBoardOwnerActions(
    boardId,
    ownerBoard ? [ownerBoard] : [],
    (action) =>
      setNotice(
        action === 'visibility'
          ? 'Board visibility updated.'
          : 'Board moved. Its link and board memberships are unchanged; visibility is now Private.',
      ),
  );
  const policy = useBoardPolicyCapabilities(boardId, ownsActive);
  const checkingAccess = !verified && !board.isError;
  usePageTitle(
    !unavailable && verified
      ? `${membersPage ? 'Members · ' : ''}${board.data?.name ?? 'Board'}`
      : 'Board',
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
    (data.capabilities?.canManageBoard ??
      data.currentUserRole === BoardRole.OWNER) &&
    !data.isArchived;
  const readOnly =
    data.isArchived ||
    data.currentUserRole === null ||
    data.capabilities?.canWriteBoard === false;
  const canRestore =
    data.isArchived &&
    (data.capabilities?.canRestoreBoard ??
      data.currentUserRole === BoardRole.OWNER);

  return (
    <PageContainer fill>
      {editing && editDirty && (
        <BoardEditNavigationGuard onDiscard={closeEditor} />
      )}
      <nav
        aria-label="Board breadcrumb"
        className="mb-3 text-xs leading-5 text-muted md:hidden"
      >
        <ol className="flex flex-wrap items-center gap-x-2">
          {workspace && (
            <li className="min-w-0 max-w-full [overflow-wrap:anywhere]">
              <Link
                className="rounded hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                to={workspacePath(workspace.id)}
              >
                {workspace.name}
              </Link>
              <span aria-hidden="true"> /</span>
            </li>
          )}
          <li>
            <Link
              className="rounded hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
              to={
                workspace ? `${workspacePath(workspace.id)}/boards` : '/boards'
              }
            >
              Boards
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li
            aria-current="page"
            className="min-w-0 max-w-full [overflow-wrap:anywhere]"
          >
            {data.name}
          </li>
        </ol>
      </nav>
      <div className="flex items-start gap-3 md:gap-4">
        <BoardIcon
          boardId={data.id}
          className="size-10 shrink-0 rounded-xl text-xl md:size-12 md:text-2xl"
        />
        <div className="min-w-0 flex-1">
          <h1
            title={data.name}
            className="line-clamp-2 text-xl leading-tight font-bold tracking-tight text-ink [overflow-wrap:anywhere] md:text-2xl"
          >
            {data.name}
          </h1>
          {data.description && (
            <p
              title={data.description}
              className="mt-1 line-clamp-2 text-sm text-muted [overflow-wrap:anywhere]"
            >
              {data.description}
            </p>
          )}
        </div>
        <ActionMenu
          className="shrink-0 [&>button]:size-11"
          label={`Actions for ${data.name}`}
          items={[
            {
              label: 'Archived cards',
              onSelect: () => setShowingArchivedCards(true),
            },
            { label: 'Copy board link', onSelect: () => void copyBoardLink() },
          ]}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <RoleChip role={data.currentUserRole} />
        {data.visibility && (
          <span className="text-muted">
            {data.visibility === 'PRIVATE' ? 'Private' : 'Workspace visible'}
          </span>
        )}
        <BoardPresence
          boardId={data.id}
          canReadMembers={data.currentUserRole !== null}
        />
        <RealtimeStatus {...realtime} />
      </div>
      <BoardNavigation
        boardId={data.id}
        active={settings ? 'settings' : membersPage ? 'members' : 'kanban'}
        canReadMembers={data.currentUserRole !== null}
        onActivity={() => setShowingActivity(true)}
      />

      {(notice || copyStatus !== 'idle' || data.isArchived) && (
        <div className="mt-4 space-y-3">
          {notice && <Alert variant="success">{notice}</Alert>}
          {copyStatus === 'copied' && (
            <Alert variant="success">Board link copied.</Alert>
          )}
          {copyStatus === 'fallback' && (
            <TextField
              label="Board link"
              value={boardUrl}
              readOnly
              hint="Clipboard unavailable. Select this link and copy it. Opening it requires board access."
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
          {data.isArchived && <ArchivedBoardNotice />}
        </div>
      )}

      {settings ? (
        <BoardSettings
          board={data}
          workspace={workspace}
          canManage={canManage}
          canRestore={canRestore}
          canMove={ownsActive}
          canChangeVisibility={
            ownsActive && policy.data?.canChangeVisibility === true
          }
          policyMessage={
            ownsActive && !policy.data?.canChangeVisibility
              ? policy.isError
                ? 'Could not check workspace rules. Try again later.'
                : policy.isPending
                  ? 'Checking workspace rules…'
                  : 'Workspace rules do not allow visibility changes.'
              : undefined
          }
          onEdit={() => setEditing(true)}
          onVisibility={() => ownerActions.open(ownerBoard!, 'visibility')}
          onMove={() => ownerActions.open(ownerBoard!, 'move')}
          onArchive={() => setArchiving(true)}
          onRestore={() => setRestoring(true)}
        />
      ) : membersPage ? (
        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          {data.currentUserRole === null ? (
            <BoardUnavailable />
          ) : (
            <Outlet context={{ board }} />
          )}
        </div>
      ) : (
        <div className="mt-5 min-h-0 flex-1 short:mt-3">
          <KanbanBoard
            boardId={data.id}
            readOnly={readOnly}
            canReadMembers={data.currentUserRole !== null}
            boardName={data.name}
          />
        </div>
      )}

      {showingArchivedCards && (
        <ArchivedCardsDialog
          boardId={data.id}
          isArchived={data.isArchived}
          canRestore={board.isError ? undefined : !readOnly}
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
      {editing && (
        <EditBoardDialog
          board={data}
          open
          onClose={closeEditor}
          onDirtyChange={setEditDirty}
          disabledReason={
            !canManage
              ? 'Editing is no longer available for this board.'
              : undefined
          }
          onSaved={(saved) => {
            closeEditor();
            setNotice(`Board “${saved.name}” updated.`);
          }}
        />
      )}
      {ownerActions.dialog}
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
      {canRestore && restoring && (
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
