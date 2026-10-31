import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Dialog } from '../../../components/Dialog';
import { Pagination } from '../../../components/Pagination';
import { ActivityIcon, ArrowRightIcon } from '../../../components/icons';
import { useWorkspaceActivity } from '../hooks';
import type { WorkspaceActivityItem, WorkspaceViewState } from '../types';

const labels: Record<string, string> = {
  WORKSPACE_CREATED: 'created the workspace',
  WORKSPACE_UPDATED: 'updated the workspace',
  POLICY_UPDATED: 'updated workspace policies',
  MEMBER_JOINED: 'joined the workspace',
  MEMBER_ROLE_CHANGED: 'changed a member role',
  MEMBER_REMOVED: 'removed a member',
  MEMBER_LEFT: 'left the workspace',
  INVITATION_REQUESTED: 'requested an invitation',
  INVITATION_REVOKED: 'revoked an invitation',
  INVITATION_DECLINED: 'declined an invitation',
  BOARD_MOVED: 'moved a board into the workspace',
};

function ActivityRows({ items }: { items: WorkspaceActivityItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
            <ActivityIcon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">
            <p>
              <strong>{item.actor?.displayName || 'Unknown user'}</strong>{' '}
              {Object.hasOwn(labels, item.eventType)
                ? labels[item.eventType]
                : 'performed a workspace action'}
              {item.board && (
                <>
                  :{' '}
                  <Link
                    className="text-primary underline"
                    to={`/boards/${encodeURIComponent(item.board.id)}`}
                  >
                    {item.board.name}
                  </Link>
                </>
              )}
            </p>
            <time className="text-xs text-muted" dateTime={item.createdAt}>
              {new Date(item.createdAt).toLocaleString()}
            </time>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityContent({
  query,
}: {
  query: ReturnType<typeof useWorkspaceActivity>;
}) {
  if (query.isError)
    return (
      <div role="alert" className="text-sm text-muted">
        Unable to load activity.{' '}
        <button
          className="text-primary underline"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </div>
    );
  if (!query.pageData)
    return (
      <div role="status" className="space-y-3 motion-safe:animate-pulse">
        <span className="sr-only">Loading activity</span>
        {[1, 2, 3].map((n) => (
          <div key={n} aria-hidden="true" className="h-10 rounded bg-line" />
        ))}
      </div>
    );
  if (!query.pageData.items.length)
    return (
      <p role="status" className="py-6 text-sm text-muted">
        Activity will appear when workspace changes happen.
      </p>
    );
  return <ActivityRows items={query.pageData.items} />;
}

function History({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const query = useWorkspaceActivity(workspaceId, page, 20, true);
  useEffect(() => {
    if (query.pageData && page > Math.max(1, query.pageData.meta.totalPages))
      setPage(Math.max(1, query.pageData.meta.totalPages));
  }, [page, query.pageData]);
  return (
    <Dialog open onClose={onClose} title="Workspace activity">
      {query.isError ? (
        <div role="alert" className="text-sm text-muted">
          Unable to load activity.{' '}
          <button
            className="text-primary underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      ) : !query.pageData ? (
        <p role="status" className="text-sm text-muted">
          Loading activity…
        </p>
      ) : (
        <>
          {query.pageData.items.length ? (
            <ActivityRows items={query.pageData.items} />
          ) : (
            <p role="status" className="text-sm text-muted">
              Activity will appear when workspace changes happen.
            </p>
          )}
          <p className="mt-4 text-xs text-muted">
            {query.pageData.meta.total} events
          </p>
          <Pagination
            label="Activity pages"
            page={page}
            pageCount={query.pageData.meta.totalPages}
            onChange={setPage}
          />
        </>
      )}
      <button
        type="button"
        className="mt-5 min-h-11 rounded text-sm text-primary focus-visible:outline-2 focus-visible:outline-primary"
        onClick={onClose}
      >
        Close
      </button>
    </Dialog>
  );
}

function ActivityPanel({
  workspaceId,
  state,
}: {
  workspaceId: string;
  state: WorkspaceViewState;
}) {
  const [open, setOpen] = useState(false);
  const query = useWorkspaceActivity(workspaceId, 1, 5, state === 'ready');
  return (
    <section
      aria-labelledby="workspace-activity"
      className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="workspace-activity" className="text-sm font-semibold text-ink">
          Activity
        </h2>
        <button
          type="button"
          aria-disabled={!query.pageData?.meta.total}
          onClick={() => {
            if (query.pageData?.meta.total) setOpen(true);
          }}
          className="flex min-h-11 items-center gap-1.5 rounded text-xs text-primary focus-visible:outline-2 focus-visible:outline-primary aria-disabled:text-muted aria-disabled:opacity-50"
        >
          View all <ArrowRightIcon aria-hidden="true" className="size-3.5" />
        </button>
      </header>
      {state === 'ready' ? (
        <ActivityContent query={query} />
      ) : state === 'loading' ? (
        <p role="status" className="text-sm text-muted">
          Loading activity…
        </p>
      ) : (
        <p className="text-sm text-muted">Activity unavailable.</p>
      )}
      {open && state === 'ready' && (
        <History workspaceId={workspaceId} onClose={() => setOpen(false)} />
      )}
    </section>
  );
}

export function WorkspaceActivity({ state }: { state: WorkspaceViewState }) {
  const { workspaceId = '' } = useParams();
  return (
    <ActivityPanel key={workspaceId} workspaceId={workspaceId} state={state} />
  );
}
