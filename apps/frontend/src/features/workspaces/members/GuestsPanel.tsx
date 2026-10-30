import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Pagination } from '../../../components/Pagination';
import { SearchField } from '../../../components/SearchField';
import { EmptyState } from '../../../components/states';
import { LockIcon, UserIcon } from '../../../components/icons';
import { UserAvatar } from '../../auth/components/UserAvatar';
import { RoleChip } from '../../boards/components/RoleChip';
import { WorkspaceState } from '../components/WorkspaceState';
import type { WorkspaceViewState } from '../types';
import { useWorkspaceGuests } from './hooks';
import type { GuestFilters } from './types';

export const GUESTS_PAGE_SIZE = 10;

/** Read-only directory of server-authorized identities and associations. */
export function GuestsPanel({
  workspaceId,
  workspaceState,
}: {
  workspaceId: string;
  workspaceState: WorkspaceViewState;
}) {
  const [params, setParams] = useSearchParams();
  const draft = (params.get('q') ?? '').slice(0, 120);
  const [settled, setSettled] = useState(draft.trim());
  const scopeId = useId();
  const requestedPage = Number(params.get('page') ?? 1);
  const filters: GuestFilters = {
    search: settled,
    page:
      Number.isSafeInteger(requestedPage) &&
      requestedPage > 0 &&
      requestedPage <= 1000000
        ? requestedPage
        : 1,
    limit: GUESTS_PAGE_SIZE,
  };
  const debouncing = draft.trim() !== settled;
  useEffect(() => {
    const timer = setTimeout(() => setSettled(draft.trim()), draft ? 300 : 0);
    return () => clearTimeout(timer);
  }, [draft]);
  const update = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    void setParams(next, { replace, flushSync: true });
  };
  const query = useWorkspaceGuests(
    workspaceId,
    filters,
    debouncing && workspaceState === 'ready' ? 'loading' : workspaceState,
  );
  const page = query.pageData;
  useEffect(() => {
    if (page && filters.page > Math.max(1, page.pageCount))
      update(
        { page: page.pageCount > 1 ? String(page.pageCount) : null },
        true,
      );
  });

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border border-line bg-surface p-4 sm:px-5"
        id={scopeId}
      >
        <div className="flex items-start gap-3">
          <LockIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-primary"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">
              Guests on boards you can view member details for
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Guests are board members who haven’t joined this workspace. Other
              private board guests are not included. Workspace admin or
              read-only board access does not grant access to member details.
            </p>
          </div>
        </div>
      </div>
      <SearchField
        label="Search guests"
        placeholder="Search guests by name..."
        value={draft}
        onChange={(value) => update({ q: value.slice(0, 120) || null }, true)}
        disabled={workspaceState !== 'ready'}
        describedBy={scopeId}
      />
      {workspaceState === 'ready' && (
        <WorkspaceState
          state={query.state}
          retry={() => void query.refetch()}
        />
      )}
      {page && page.items.length === 0 && (
        <EmptyState
          icon={<UserIcon className="size-6" />}
          title={
            settled
              ? 'No matching guests in this directory'
              : 'No guests on boards you can see member details for'
          }
          description={
            settled
              ? 'Try another name. Search only covers guests whose board membership you can inspect.'
              : 'Guests will appear here when they belong to a board whose member details you can view. Other private boards may have guests.'
          }
        />
      )}
      {page && page.items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5 border-b border-line bg-app/60 px-5 py-2.5 text-xs font-medium text-muted sm:grid"
          >
            <span>Name</span>
            <span>Permitted boards · Board role</span>
          </div>
          <ul
            aria-label="Guests and permitted boards"
            className="divide-y divide-line"
          >
            {page.items.map((guest) => (
              <li
                key={guest.user.id}
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-5 sm:px-5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <UserAvatar
                    user={guest.user}
                    className="size-9 text-[13px]"
                  />
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold break-words text-ink [overflow-wrap:anywhere]">
                      {guest.user.displayName}
                    </h4>
                    <p className="mt-1 text-xs text-muted">
                      {guest.visibleBoardCount} permitted{' '}
                      {guest.visibleBoardCount === 1 ? 'board' : 'boards'}
                    </p>
                  </div>
                </div>
                <ul
                  aria-label={`Permitted boards for ${guest.user.displayName}`}
                  className="min-w-0 space-y-2"
                >
                  {guest.boards.map((board) => (
                    <li
                      key={board.boardId}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
                    >
                      <Link
                        to={`/boards/${encodeURIComponent(board.boardId)}`}
                        className="min-w-0 rounded py-1 text-sm font-medium break-words text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [overflow-wrap:anywhere]"
                      >
                        {board.name}
                      </Link>
                      <RoleChip role={board.role} />
                      {board.isArchived && (
                        <span className="rounded-md border border-line bg-app px-2 py-0.5 text-xs text-muted">
                          Archived · Read-only
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {page && (
        <div className="space-y-3">
          <p role="status" className="text-xs text-muted">
            {page.total} {page.total === 1 ? 'guest' : 'guests'}{' '}
            {settled
              ? 'matching this search in this directory'
              : 'in this directory'}
          </p>
          <Pagination
            label="Workspace guests pages"
            page={page.page}
            pageCount={page.pageCount}
            onChange={(value) =>
              update({ page: value > 1 ? String(value) : null })
            }
          />
        </div>
      )}
    </div>
  );
}
