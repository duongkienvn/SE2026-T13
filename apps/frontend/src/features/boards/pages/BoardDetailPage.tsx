import { BoardRole } from '@kanban/shared';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Link,
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
import { Button, buttonClassName } from '../../../components/Button';
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
import { BoardStar } from '../components/BoardStar';
import { useRecordBoardView } from '../useRecordBoardView';
import {
  BoardBackgroundDialog,
  backgroundStyle,
  useBackgroundPresets,
} from '../components/BoardBackground';
import { EditBoardDialog } from '../components/BoardFormDialog';
import { RoleChip } from '../components/RoleChip';
import { useVerifiedBoard } from '../useVerifiedBoard';
import { revokeBoardAccess } from '../revoke-board-access';
import type { BoardsLocationState } from './BoardsPage';
import { ArchivedCardsDialog } from '../../cards/components/ArchivedCardsDialog';
import { useBoardPolicyCapabilities } from '../../board-members/hooks';
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

function BoardEditNavigationGuard() {
  const blocker = useBlocker(true);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Discard unsaved board changes?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  return null;
}

export function BoardDetailPage() {
  const workspace = useOutletContext<WorkspaceSummary | undefined>();
  const { boardId = '' } = useParams();
  const navigate = useNavigate();
  const settings = useMatch('/boards/:boardId/settings') !== null;
  const { board, verified } = useVerifiedBoard(boardId);
  const client = useQueryClient();
  useRecordBoardView(boardId, verified && !board.isError && !settings);
  const unavailable = board.isError && isBoardUnavailable(board.error);
  const realtime = useBoardRealtime(boardId, {
    enabled: verified && board.data !== undefined && !unavailable,
  });
  const [editing, setEditing] = useState(false);
  const [changingBackground, setChangingBackground] = useState(false);
  const presets = useBackgroundPresets();
  const [editDirty, setEditDirty] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showingActivity, setShowingActivity] = useState(false);
  const [showingArchivedCards, setShowingArchivedCards] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string>();
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
      {editing && editDirty && <BoardEditNavigationGuard />}
      <nav
        aria-label="Board breadcrumb"
        className="mb-4 text-xs leading-6 text-muted md:hidden"
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
      <div
        className="flex flex-col gap-5 rounded-xl p-3 md:flex-row md:items-start"
        style={backgroundStyle(
          presets.data?.find(
            (item) => item.id === board.data?.backgroundPreset,
          ),
        )}
      >
        <BoardIcon boardId={data.id} className="size-12 rounded-xl text-2xl" />
        <div className="min-w-0 flex-1 rounded-lg bg-surface p-3">
          <PageHeader
            title={data.name}
            description={data.description ?? undefined}
            actions={
              <>
                <BoardStar boardId={data.id} boardName={data.name} />
                <BoardPresence
                  boardId={data.id}
                  canReadMembers={data.currentUserRole !== null}
                />
                <RealtimeStatus {...realtime} />
                <RoleChip role={data.currentUserRole} />
                {data.visibility && (
                  <span className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted">
                    {data.visibility === 'PRIVATE'
                      ? 'Private'
                      : 'Workspace visible'}
                  </span>
                )}
                {
                  <ActionMenu
                    className="ml-auto"
                    label={`Actions for ${data.name}`}
                    items={[
                      {
                        label: 'About this board',
                        onSelect: () =>
                          navigate(`/boards/${data.id}/settings#board-general`),
                      },
                      {
                        label: 'Activity history',
                        onSelect: () => setShowingActivity(true),
                      },
                      {
                        label: 'Archived cards',
                        onSelect: () => setShowingArchivedCards(true),
                      },
                      {
                        label: 'Board settings',
                        onSelect: () => navigate(`/boards/${data.id}/settings`),
                      },
                      ...(canManage
                        ? [
                            {
                              label: 'Edit board',
                              onSelect: () => setEditing(true),
                            },
                            ...(data.capabilities?.canManageBoard === true &&
                            data.currentUserRole === BoardRole.OWNER
                              ? [
                                  {
                                    label: 'Change background',
                                    onSelect: () => setChangingBackground(true),
                                  },
                                ]
                              : []),
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
                                      ownerActions.open(
                                        ownerBoard!,
                                        'visibility',
                                      ),
                                  },
                                  {
                                    label: 'Move to workspace',
                                    onSelect: () =>
                                      ownerActions.open(ownerBoard!, 'move'),
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
                      ...(canRestore
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

      <nav
        aria-label="Board navigation"
        className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-b border-line text-sm"
      >
        <Link
          className={`border-b-2 py-3 font-medium hover:text-primary ${!settings ? 'border-primary text-primary' : 'border-transparent'}`}
          aria-current={!settings ? 'page' : undefined}
          to={`/boards/${data.id}`}
        >
          Kanban
        </Link>
        {data.currentUserRole !== null && (
          <Link
            className="py-3 font-medium hover:text-primary"
            to={`/boards/${data.id}/members`}
          >
            Members
          </Link>
        )}
        <button
          type="button"
          className="border-b-2 border-transparent py-3 font-medium hover:text-primary"
          onClick={() => setShowingActivity(true)}
        >
          Activity
        </button>
        <Link
          className={`border-b-2 py-3 font-medium hover:text-primary ${settings ? 'border-primary text-primary' : 'border-transparent'}`}
          aria-current={settings ? 'page' : undefined}
          to={`/boards/${data.id}/settings`}
        >
          Board settings
        </Link>
      </nav>

      <div className="mt-4 space-y-3">
        {notice && <Alert variant="success">{notice}</Alert>}
        {data.isArchived && <ArchivedBoardNotice />}
      </div>

      {settings ? (
        <div className="mt-6 grid gap-8 pb-10 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <nav
            aria-label="Settings sections"
            className="flex flex-wrap gap-4 text-sm lg:flex-col"
          >
            <a href="#board-general">General</a>
            <a href="#board-permissions">Permissions</a>
            <a href="#board-members">Members</a>
            <a href="#board-danger">Danger zone</a>
          </nav>
          <div className="max-w-3xl space-y-10">
            <section id="board-general" className="space-y-3">
              <h2 className="text-xl font-semibold">General</h2>
              <p className="text-sm text-muted">Board name and description</p>
              <p className="font-medium [overflow-wrap:anywhere]">
                {data.name}
              </p>
              <p className="text-sm text-muted [overflow-wrap:anywhere]">
                {data.description || 'No description added.'}
              </p>
              <p className="text-sm text-muted">
                Status: {data.isArchived ? 'Archived' : 'Active'}
              </p>
              {workspace && (
                <p className="text-sm text-muted">
                  Workspace: {workspace.name}
                </p>
              )}
              {data.backgroundPreset && (
                <p className="text-sm text-muted">
                  Background: {data.backgroundPreset}
                </p>
              )}
              {canManage && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit board
                </Button>
              )}
            </section>
            <section
              id="board-permissions"
              className="space-y-3 border-t border-line pt-6"
            >
              <h2 className="text-xl font-semibold">Permissions</h2>
              <p className="text-sm text-muted">
                Visibility:{' '}
                {data.visibility === 'WORKSPACE_VISIBLE'
                  ? 'Workspace visible'
                  : data.visibility === 'PRIVATE'
                    ? 'Private'
                    : 'Unavailable'}
              </p>
              <p className="text-sm text-muted">
                Private boards are accessible to board members.
                Workspace-visible boards can be viewed by workspace members;
                editing requires board membership.
              </p>
              {ownsActive && (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    disabled={!policy.data?.canChangeVisibility}
                    onClick={() => ownerActions.open(ownerBoard!, 'visibility')}
                  >
                    Change visibility
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => ownerActions.open(ownerBoard!, 'move')}
                  >
                    Move to workspace
                  </Button>
                </div>
              )}
              {ownsActive && !policy.data?.canChangeVisibility && (
                <p className="text-sm text-muted">
                  {policy.isError
                    ? 'Could not check workspace rules. Try again later.'
                    : policy.isPending
                      ? 'Checking workspace rules…'
                      : 'Workspace rules do not allow visibility changes.'}
                </p>
              )}
            </section>
            <section
              id="board-members"
              className="space-y-3 border-t border-line pt-6"
            >
              <h2 className="text-xl font-semibold">Members</h2>
              <p className="text-sm text-muted">
                Board membership determines who can collaborate on this board.
              </p>
              {data.currentUserRole !== null ? (
                <Link
                  className={buttonClassName('secondary')}
                  to={`/boards/${data.id}/members`}
                >
                  View board members
                </Link>
              ) : (
                <p className="text-sm text-muted">
                  Member details are available to board members.
                </p>
              )}
            </section>
            <section
              id="board-danger"
              className="space-y-3 border-t border-line pt-6"
            >
              <h2 className="text-xl font-semibold">Danger zone</h2>
              <p className="text-sm text-muted">
                Archiving makes this board read-only while preserving its cards
                and history.
              </p>
              {canManage && (
                <Button variant="secondary" onClick={() => setArchiving(true)}>
                  Archive board
                </Button>
              )}
              {canRestore && (
                <Button variant="secondary" onClick={() => setRestoring(true)}>
                  Restore board
                </Button>
              )}
            </section>
          </div>
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
          onClose={() => {
            setEditing(false);
            setEditDirty(false);
          }}
          onDirtyChange={setEditDirty}
          disabledReason={
            !canManage
              ? 'Editing is no longer available for this board.'
              : undefined
          }
          onSaved={(saved) => {
            setEditing(false);
            setEditDirty(false);
            setNotice(`Board “${saved.name}” updated.`);
          }}
        />
      )}
      {ownerActions.dialog}
      {changingBackground && (
        <BoardBackgroundDialog
          board={data}
          canManage={
            data.capabilities?.canManageBoard === true &&
            data.currentUserRole === BoardRole.OWNER &&
            !data.isArchived
          }
          onClose={() => setChangingBackground(false)}
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
