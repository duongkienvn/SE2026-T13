import { useEffect, useState } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { Pagination } from '../../../components/Pagination';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { isApiError } from '../../../lib/api-client';
import { formatDateTime, formatRelativeTime } from '../../../lib/format';
import { UserAvatar } from '../../auth/components/UserAvatar';
import { useAuth } from '../../auth/useAuth';
import { useBoardMembers } from '../../board-members/hooks';
import type { BoardMember } from '../../board-members/types';
import {
  describeActivity,
  resolveActor,
  validTimestamp,
} from '../format-activity';
import { useActivities } from '../hooks';
import type { Activity } from '../types';

/** Lost session or access: never keep showing cached history. */
function isAccessError(error: unknown): boolean {
  return isApiError(error) && [401, 403, 404].includes(error.status);
}

interface ActivityHistoryDialogProps {
  boardId: string;
  open: boolean;
  onClose: () => void;
  canReadMembers?: boolean;
}

/** Read-only, server-ordered (newest first) history of one board. */
export function ActivityHistoryDialog({
  boardId,
  open,
  onClose,
  canReadMembers = true,
}: ActivityHistoryDialogProps) {
  const [page, setPage] = useState(1);
  const query = useActivities(boardId, page, { enabled: open });
  // Names come from the member list; wait for it so current members don't
  // flash as "Former member". If it fails, rows fall back to generic names.
  const members = useBoardMembers(boardId, { enabled: canReadMembers });
  const unavailable = query.isError && isAccessError(query.error);
  const pageData = unavailable ? undefined : query.data;

  // Concurrent changes can shrink the history below the current page.
  useEffect(() => {
    if (!pageData || query.isPlaceholderData) return;
    const lastPage = Math.max(1, pageData.meta.totalPages);
    if (page > lastPage) setPage(lastPage);
  }, [page, pageData, query.isPlaceholderData]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Activity"
      description="Changes on this board, newest first."
    >
      <div className="flex min-h-10 items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {pageData &&
            `${pageData.meta.total} ${
              pageData.meta.total === 1 ? 'activity' : 'activities'
            }`}
        </p>
        {!unavailable && (
          <Button
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh
          </Button>
        )}
      </div>

      <div className="mt-3">
        {query.isError && pageData && (
          <div className="mb-3">
            <Alert variant="error">Activity could not be refreshed.</Alert>
          </div>
        )}
        {query.isPending ||
        (canReadMembers && pageData && members.isPending) ? (
          <LoadingState label="Loading activity…" />
        ) : query.isError && !pageData ? (
          <ErrorState
            title={
              unavailable ? 'Activity unavailable' : 'We couldn’t load activity'
            }
            description={
              unavailable
                ? 'This board no longer exists, or you no longer have access to it.'
                : 'Check your connection and try again.'
            }
            onRetry={unavailable ? undefined : () => void query.refetch()}
          />
        ) : pageData?.items.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Changes to this board will appear here."
          />
        ) : (
          pageData && (
            <ActivityList
              items={pageData.items}
              members={canReadMembers ? (members.data ?? []) : []}
              canReadMembers={canReadMembers}
            />
          )
        )}
        {pageData && (
          <Pagination
            label="Activity pages"
            page={page}
            pageCount={pageData.meta.totalPages}
            onChange={setPage}
            className="mt-3"
          />
        )}
      </div>
    </Dialog>
  );
}

function ActivityList({
  items,
  members,
  canReadMembers,
}: {
  items: Activity[];
  members: BoardMember[];
  canReadMembers: boolean;
}) {
  const { user } = useAuth();

  return (
    <ol aria-label="Activity" className="space-y-3 short:space-y-2">
      {items.map((activity, index) => {
        const actor = resolveActor(
          activity.actorId,
          members,
          user,
          canReadMembers,
        );
        const { action, detail } = describeActivity(activity);
        const timestamp = validTimestamp(activity.createdAt);
        return (
          <li key={activity.id} className="relative flex gap-3 pl-5 text-sm">
            <span
              aria-hidden="true"
              className="absolute top-2 left-0 size-2.5 rounded-full border-2 border-line bg-surface"
            />
            {index < items.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute top-5 -bottom-3 left-[4px] w-px bg-line short:-bottom-2"
              />
            )}
            {actor.user ? (
              <UserAvatar user={actor.user} className="size-7 text-[11px]" />
            ) : (
              <span
                aria-hidden="true"
                className="size-7 shrink-0 rounded-full bg-app"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="break-words text-ink">
                <span className="font-semibold">{actor.name}</span> {action}
              </p>
              <p className="text-xs text-muted">
                {detail && <span>{detail} · </span>}
                {timestamp ? (
                  <time dateTime={timestamp} title={formatDateTime(timestamp)}>
                    {formatRelativeTime(timestamp)}
                  </time>
                ) : (
                  <span>Unknown time</span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
