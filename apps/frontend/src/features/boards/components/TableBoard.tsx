import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '../../../components/states';
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  SearchIcon,
} from '../../../components/icons';
import { LabelBadge } from '../../labels/components/LabelBadge';
import { ChecklistProgress } from './ChecklistProgress';
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
    <div className="board-view-workspace">
      <div className="board-view-toolbar">
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
          <div className="board-table-toolbar">
            <BoardFilter
              compact
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
              className="board-table-search"
              onSubmit={(event) => {
                event.preventDefault();
                apply({ ...filters, q: search.trim() || undefined });
              }}
            >
              <button
                type="submit"
                aria-label="Search cards"
                title="Search cards"
              >
                <SearchIcon className="size-4" />
              </button>
              <label>
                <span className="sr-only">Search cards</span>
                <input
                  className="text-ink"
                  placeholder="Search cards..."
                  value={search}
                  maxLength={200}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
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
            <div className="board-table-panel">
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
                <table className="board-table">
                  <colgroup>
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: 64 }} />
                  </colgroup>
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
                          <ChevronDownIcon
                            className={`ml-1 inline size-3 ${sortBy === 'title' ? `text-primary ${sortDirection === 'asc' ? 'rotate-180' : ''}` : 'text-muted'}`}
                          />
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
                          <ChevronDownIcon
                            className={`ml-1 inline size-3 ${sortBy === 'dueDate' ? `text-primary ${sortDirection === 'asc' ? 'rotate-180' : ''}` : 'text-muted'}`}
                          />
                        </button>
                      </th>
                      <th scope="col" className="p-3">
                        Checklist
                      </th>
                      <th scope="col" className="p-3">
                        Column
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
                        <tr key={card.id}>
                          <td>
                            <div className="board-table-title">
                              {cardLabels[0] && (
                                <span
                                  aria-hidden="true"
                                  className="size-2 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: cardLabels[0].color,
                                  }}
                                />
                              )}
                              <button
                                className="text-ink focus-visible:outline-2 focus-visible:outline-primary"
                                onClick={() => openCard(card.id)}
                              >
                                {card.title}
                              </button>
                            </div>
                          </td>
                          <td className="max-w-64 p-3">
                            <div className="flex flex-wrap gap-1">
                              {cardLabels.map((label) => (
                                <LabelBadge key={label.id} label={label} />
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
                            <div className="flex flex-wrap gap-1">
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
                              <span className="board-table-date">
                                <CalendarIcon className="size-4 shrink-0" />
                                <time dateTime={card.dueDate}>
                                  {formatCardInstant(
                                    card.dueDate,
                                    dateFormat,
                                    timeZone,
                                  )}
                                </time>
                              </span>
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
                                  <ChecklistProgress
                                    checked={summary.checklist.checkedItems}
                                    total={summary.checklist.totalItems}
                                    label={`Checklist for ${card.title}`}
                                  />
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
                            <span className="board-table-column">
                              {columns.data?.find(
                                (column) => column.id === card.columnId,
                              )?.name ?? 'Unavailable'}
                            </span>
                          </td>
                          <td className="p-3">
                            {card.dueDate ? (
                              <DueStatusBadge
                                dueDate={card.dueDate}
                                timeZone={timeZone}
                                now={now}
                              />
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            <button
                              className="grid size-8 place-items-center rounded-md text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
                              aria-label={`Open ${card.title}`}
                              onClick={() => openCard(card.id)}
                            >
                              <ExternalLinkIcon className="size-4" />
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
                className="board-table-footer"
              >
                <span>
                  {total
                    ? `Showing ${(page - 1) * cards.data!.meta.limit + 1}–${Math.min(page * cards.data!.meta.limit, total)} of ${total} cards`
                    : '0 cards'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="board-page-button"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeftIcon className="size-4" />
                    <span className="sr-only">Previous</span>
                  </button>
                  <span
                    aria-current="page"
                    aria-label={`Page ${page} of ${Math.max(1, cards.data?.meta.totalPages ?? 1)}`}
                    className="grid size-8 place-items-center rounded-md bg-primary-solid font-medium text-white"
                  >
                    {page}
                  </span>
                  <button
                    className="board-page-button"
                    disabled={page >= (cards.data?.meta.totalPages ?? 1)}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRightIcon className="size-4" />
                    <span className="sr-only">Next</span>
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
