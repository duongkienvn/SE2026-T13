import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '../../../components/states';
import { isApiError } from '../../../lib/api-client';
import { UserAvatar } from '../../auth/components/UserAvatar';
import { useBoardMembers } from '../../board-members/hooks';
import {
  BoardFilter,
  useBoardFilters,
  useFilteredCards,
  usePreviewSummaries,
} from '../../cards/board-filter';
import { formatCardInstant } from '../../cards/card-dates';
import { CardDetailDialog } from '../../cards/components/CardDetailDialog';
import {
  DueStatusBadge,
  useDatePreferences,
} from '../../cards/components/detail/CardDates';
import { useCardRoute } from '../../cards/useCardRoute';
import { useColumns } from '../../columns/hooks';
import { useLabelCatalog } from '../../labels/hooks';
import { boardKeys } from '../query-keys';
import { BoardViews } from './BoardViews';

export function TableBoard({
  boardId,
  boardName,
  readOnly,
  canReadMembers,
}: {
  boardId: string;
  boardName: string;
  readOnly: boolean;
  canReadMembers: boolean;
}) {
  const client = useQueryClient();
  const { filters, apply, active } = useBoardFilters();
  const [search, setSearch] = useState(filters.q ?? '');
  const [now, setNow] = useState(Date.now);
  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);
  const [sortBy, setSortBy] = useState<'title' | 'dueDate'>('title');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const cards = useFilteredCards(
    boardId,
    { ...filters, sortBy, sortDirection },
    page,
    true,
  );
  const columns = useColumns(boardId);
  const labels = useLabelCatalog(boardId);
  const members = useBoardMembers(boardId, { enabled: canReadMembers });
  const summaries = usePreviewSummaries(
    boardId,
    (cards.data?.items ?? []).map((card) => card.id),
  );
  const {
    timeZone,
    dateFormat,
    loading: preferencesLoading,
  } = useDatePreferences();
  const { cardId, openCard, closeCard } = useCardRoute(boardId);
  const denied = [
    cards.error,
    columns.error,
    labels.error,
    summaries.error,
    canReadMembers ? members.error : null,
  ].some((error) => isApiError(error) && [403, 404].includes(error.status));
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [boardId, filterKey, sortBy, sortDirection]);
  useEffect(() => {
    if (cards.data && page > Math.max(1, cards.data.meta.totalPages))
      setPage(Math.max(1, cards.data.meta.totalPages));
  }, [cards.data, page]);
  useEffect(() => {
    if (denied)
      void client.invalidateQueries({
        queryKey: boardKeys.detail(boardId),
        exact: true,
      });
  }, [denied, client, boardId]);
  useEffect(() => {
    const current = Date.now();
    const delay = (cards.data?.items ?? []).reduce(
      (next, card) => {
        const remaining = card.dueDate
          ? Date.parse(card.dueDate) - current + 1
          : Infinity;
        return remaining > 0 ? Math.min(next, remaining) : next;
      },
      60_000 - (current % 60_000),
    );
    const timer = window.setTimeout(() => {
      setNow(Date.now());
      if (filters.dueStatus)
        void client.invalidateQueries({
          queryKey: [...boardKeys.cards(boardId), 'filtered'],
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [boardId, cards.data, client, filters.dueStatus, now]);
  const changeSort = (key: 'title' | 'dueDate') => {
    if (key === sortBy)
      setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDirection('asc');
    }
  };
  const opened = cards.data?.items.find((card) => card.id === cardId);
  const total = cards.data?.meta.total ?? 0;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-x-hidden overflow-y-auto p-4 md:p-6">
      <div className="rounded-xl border border-line bg-surface/90 p-2">
        <BoardViews boardId={boardId} active="table" />
      </div>
      {denied ? (
        <div>
          <LoadingState label="Checking board access…" />
          {active && (
            <button
              className="text-primary underline"
              onClick={() => {
                setSearch('');
                apply({});
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-col items-stretch gap-2 rounded-xl bg-surface/90 p-2 sm:flex-row sm:items-center [&>div]:mb-0 [&>div]:min-w-0 sm:[&>div]:flex-1">
            <BoardFilter
              filters={filters}
              apply={(next) => {
                setSearch(next.q ?? '');
                apply(next);
              }}
              labels={labels.data ?? []}
              labelsPending={labels.isPending}
              labelsError={labels.isError}
              members={canReadMembers ? (members.data ?? []) : []}
              membersPending={canReadMembers && members.isPending}
              membersError={canReadMembers && members.isError}
              retryLabels={() => void labels.refetch()}
              retryMembers={() => void members.refetch()}
              clearLabel="Clear all"
            />
            <form
              className="flex min-w-0 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                apply({ ...filters, q: search.trim() || undefined });
              }}
            >
              <label className="block text-sm text-muted">
                <span className="sr-only">Search cards</span>
                <input
                  className="max-w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink"
                  placeholder="Search cards..."
                  value={search}
                  maxLength={200}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="min-h-10 rounded px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-primary"
              >
                Search
              </button>
            </form>
          </div>
          {cards.isPending || columns.isPending || preferencesLoading ? (
            <LoadingState label="Loading table…" />
          ) : cards.isError || columns.isError ? (
            <ErrorState
              title="Could not load table"
              description="Check your connection and try again."
              onRetry={() => {
                void cards.refetch();
                void columns.refetch();
              }}
            />
          ) : (
            <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface/90 text-sm text-ink">
              {(labels.isError || (canReadMembers && members.isError)) && (
                <p role="alert" className="p-3 text-danger">
                  Some card metadata could not be loaded.{' '}
                  <button
                    className="underline"
                    onClick={() => {
                      if (labels.isError) void labels.refetch();
                      if (canReadMembers && members.isError)
                        void members.refetch();
                    }}
                  >
                    Retry
                  </button>
                </p>
              )}
              {summaries.isError && (
                <p role="alert" className="p-3 text-danger">
                  Card details could not be loaded.{' '}
                  <button
                    className="underline"
                    onClick={() => void summaries.refetch()}
                  >
                    Retry
                  </button>
                </p>
              )}
              <div className="max-w-full overflow-x-auto">
                <table className="w-full min-w-[850px] text-left">
                  <thead>
                    <tr className="border-b border-line">
                      <th
                        scope="col"
                        aria-sort={
                          sortBy === 'title'
                            ? sortDirection === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                        className="p-3"
                      >
                        <button
                          className="min-h-10 rounded focus-visible:outline-2 focus-visible:outline-primary"
                          onClick={() => changeSort('title')}
                        >
                          Card name{' '}
                          {sortBy === 'title'
                            ? sortDirection === 'asc'
                              ? '↑'
                              : '↓'
                            : '↕'}
                        </button>
                      </th>
                      <th scope="col" className="p-3">
                        Labels
                      </th>
                      <th scope="col" className="p-3">
                        Assignees
                      </th>
                      <th
                        scope="col"
                        aria-sort={
                          sortBy === 'dueDate'
                            ? sortDirection === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                        className="p-3"
                      >
                        <button
                          className="min-h-10 rounded focus-visible:outline-2 focus-visible:outline-primary"
                          onClick={() => changeSort('dueDate')}
                        >
                          Due date{' '}
                          {sortBy === 'dueDate'
                            ? sortDirection === 'asc'
                              ? '↑'
                              : '↓'
                            : '↕'}
                        </button>
                      </th>
                      <th scope="col" className="p-3">
                        Checklist
                      </th>
                      <th scope="col" className="p-3">
                        Status
                      </th>
                      <th scope="col" aria-label="Actions" className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {(cards.data?.items ?? []).map((card) => {
                      const summary = summaries.data?.find(
                        (item) => item.cardId === card.id,
                      );
                      const cardLabels =
                        labels.data?.filter((label) =>
                          summary?.labelIds.includes(label.id),
                        ) ?? [];
                      return (
                        <tr key={card.id} className="border-b border-line/70">
                          <td className="max-w-64 p-3">
                            {cardLabels[0] && (
                              <span
                                aria-hidden="true"
                                className="mr-2 inline-block size-2 rounded-full"
                                style={{ backgroundColor: cardLabels[0].color }}
                              />
                            )}
                            <button
                              data-shortcut-card
                              className="text-left font-medium break-words text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                              onClick={() => openCard(card.id)}
                            >
                              {card.title}
                            </button>
                          </td>
                          <td className="max-w-64 p-3">
                            <div className="flex flex-wrap gap-1">
                              {cardLabels.map((label) => (
                                <span
                                  key={label.id}
                                  className="rounded border-2 px-2 py-0.5 text-xs"
                                  style={{
                                    borderColor: label.color,
                                    backgroundColor: `${label.color}33`,
                                  }}
                                >
                                  {label.name}
                                </span>
                              ))}
                              {!cardLabels.length && (
                                <span className="text-muted">
                                  {labels.isError
                                    ? 'Unavailable'
                                    : summary
                                      ? '—'
                                      : summaries.isError
                                        ? 'Unavailable'
                                        : 'Loading…'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="flex gap-1">
                              {card.assignees.length ? (
                                card.assignees.map((assignee) => {
                                  const user = members.data?.find(
                                    (member) =>
                                      member.user.id === assignee.userId,
                                  )?.user;
                                  return user ? (
                                    <span
                                      key={assignee.userId}
                                      role="img"
                                      aria-label={user.displayName}
                                      title={user.displayName}
                                    >
                                      <UserAvatar
                                        user={user}
                                        className="size-7 text-xs"
                                      />
                                    </span>
                                  ) : (
                                    <span
                                      key={assignee.userId}
                                      className="text-muted"
                                    >
                                      Unavailable
                                    </span>
                                  );
                                })
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap p-3">
                            {card.dueDate ? (
                              <time dateTime={card.dueDate}>
                                {formatCardInstant(
                                  card.dueDate,
                                  dateFormat,
                                  timeZone,
                                )}
                              </time>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-3">
                            {summary ? (
                              summary.checklist.totalItems ? (
                                <div className="flex items-center gap-2">
                                  <span>
                                    {summary.checklist.checkedItems}/
                                    {summary.checklist.totalItems}
                                  </span>
                                  <span
                                    role="progressbar"
                                    aria-label={`Checklist for ${card.title}`}
                                    aria-valuenow={
                                      summary.checklist.checkedItems
                                    }
                                    aria-valuemin={0}
                                    aria-valuemax={summary.checklist.totalItems}
                                    className="h-2 w-20 overflow-hidden rounded-full bg-primary-soft"
                                  >
                                    <span
                                      className={`block h-full rounded-full ${summary.checklist.checkedItems === summary.checklist.totalItems ? 'bg-success' : 'bg-primary'}`}
                                      style={{
                                        width: `${(summary.checklist.checkedItems / summary.checklist.totalItems) * 100}%`,
                                      }}
                                    />
                                  </span>
                                </div>
                              ) : (
                                '—'
                              )
                            ) : summaries.isError ? (
                              'Unavailable'
                            ) : (
                              'Loading…'
                            )}
                          </td>
                          <td className="p-3">
                            <span className="rounded-full bg-primary-soft px-2 py-1 text-xs text-primary">
                              {columns.data?.find(
                                (column) => column.id === card.columnId,
                              )?.name ?? 'Unavailable'}
                            </span>{' '}
                            <DueStatusBadge
                              dueDate={card.dueDate}
                              timeZone={timeZone}
                              now={now}
                            />
                          </td>
                          <td className="p-3">
                            <button
                              className="rounded px-2 py-1 text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                              aria-label={`Open ${card.title}`}
                              onClick={() => openCard(card.id)}
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {total === 0 && (
                <p className="p-4 text-muted">
                  {active
                    ? 'No cards match these filters.'
                    : 'No cards on this board yet.'}
                </p>
              )}
              <nav
                aria-label="Card results pages"
                className="flex flex-wrap items-center justify-between gap-3 p-4 text-muted"
              >
                <span>
                  {total
                    ? `Showing ${(page - 1) * cards.data!.meta.limit + 1}–${Math.min(page * cards.data!.meta.limit, total)} of ${total} cards`
                    : '0 cards'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded border border-line px-3 py-1 disabled:opacity-50"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page} of{' '}
                    {Math.max(1, cards.data?.meta.totalPages ?? 1)}
                  </span>
                  <button
                    className="rounded border border-line px-3 py-1 disabled:opacity-50"
                    disabled={page >= (cards.data?.meta.totalPages ?? 1)}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </nav>
            </div>
          )}
        </>
      )}
      {cardId && !denied && (
        <CardDetailDialog
          key={`${boardId}:${cardId}`}
          boardId={boardId}
          cardId={cardId}
          initialCard={opened}
          columnName={
            columns.data?.find((column) => column.id === opened?.columnId)?.name
          }
          members={canReadMembers ? (members.data ?? []) : []}
          canReadMembers={canReadMembers}
          boardName={boardName}
          boardReadOnly={readOnly}
          onClose={closeCard}
          onOpenCard={openCard}
        />
      )}
    </div>
  );
}
