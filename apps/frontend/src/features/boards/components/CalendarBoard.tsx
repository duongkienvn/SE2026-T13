import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '../../../components/states';
import { ChevronLeftIcon, ChevronRightIcon } from '../../../components/icons';
import { isApiError } from '../../../lib/api-client';
import { useBoardMembers } from '../../board-members/hooks';
import { UserAvatar } from '../../auth/components/UserAvatar';
import {
  BoardFilter,
  useAllFilteredCards,
  useBoardFilters,
  usePreviewSummaries,
} from '../../cards/board-filter';
import { cardDueStatus, wallClockOf } from '../../cards/card-dates';
import { CardDetailDialog } from '../../cards/components/CardDetailDialog';
import {
  DueStatusBadge,
  useDatePreferences,
} from '../../cards/components/detail/CardDates';
import { useCards } from '../../cards/hooks';
import { useCardRoute } from '../../cards/useCardRoute';
import type { Card } from '../../cards/types';
import { useColumns } from '../../columns/hooks';
import { useLabelCatalog } from '../../labels/hooks';
import { calendarDays, cardsByDueDay } from '../calendar';
import { boardKeys } from '../query-keys';
import { BoardViews } from './BoardViews';
import { CalendarCardInspector } from './CalendarCardInspector';

export function CalendarBoard({
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
  const all = useCards(boardId, { enabled: !active });
  const filtered = useAllFilteredCards(boardId, filters, active);
  const cards = active ? filtered : all;
  const columns = useColumns(boardId);
  const labels = useLabelCatalog(boardId);
  const members = useBoardMembers(boardId, { enabled: canReadMembers });
  const {
    timeZone,
    dateFormat,
    loading: preferencesLoading,
  } = useDatePreferences();
  const [chosenMonth, setMonth] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const { cardId, openCard, closeCard } = useCardRoute(boardId);
  const summaries = usePreviewSummaries(
    boardId,
    (cards.data ?? []).map((card) => card.id),
  );
  const denied = [
    cards.error,
    columns.error,
    labels.error,
    summaries.error,
    canReadMembers ? members.error : null,
  ].some((error) => isApiError(error) && [403, 404].includes(error.status));
  useEffect(() => {
    if (denied)
      void client.invalidateQueries({
        queryKey: boardKeys.detail(boardId),
        exact: true,
      });
  }, [boardId, client, denied]);
  useEffect(() => {
    const current = Date.now();
    const delay = (cards.data ?? []).reduce(
      (next, card) => {
        const remaining = card.dueDate
          ? Date.parse(card.dueDate) - current + 1
          : Infinity;
        return remaining > 0 ? Math.min(next, remaining) : next;
      },
      60_000 - (current % 60_000),
    );
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [cards.data, now]);
  useEffect(() => {
    if (active && filters.dueStatus)
      void client.invalidateQueries({
        queryKey: [...boardKeys.cards(boardId), 'filtered'],
      });
  }, [active, boardId, client, filters.dueStatus, now]);
  const groups = useMemo(
    () => cardsByDueDay(cards.data ?? [], timeZone),
    [cards.data, timeZone],
  );
  const today = wallClockOf(new Date(now).toISOString(), timeZone).date;
  const month = chosenMonth ?? today.slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const days = calendarDays(year, monthNumber - 1);
  const selected = cards.data?.find((card) => card.id === selectedId);
  const visibleSelection = selected?.id;
  useEffect(() => {
    if (visibleSelection && !cardId) closeButton.current?.focus();
  }, [visibleSelection, cardId]);
  const summary = summaries.data?.find((item) => item.cardId === selected?.id);
  const opened = cards.data?.find((card) => card.id === cardId);
  const unscheduled = (cards.data ?? []).filter((card) => !card.dueDate).length;
  const changeMonth = (delta: number) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    setMonth(next.toISOString().slice(0, 7));
  };
  const select = (card: Card, button: HTMLButtonElement) => {
    selectedButton.current = button;
    setSelectedId(card.id);
  };
  const closeInspector = () => {
    setSelectedId(undefined);
    selectedButton.current?.focus();
  };
  useEffect(() => {
    if (!selectedId || cardId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setSelectedId(undefined);
        selectedButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, cardId]);
  const pill = (card: Card) => {
    const preview = summaries.data?.find((item) => item.cardId === card.id);
    const firstLabel = labels.data?.find((label) =>
      preview?.labelIds.includes(label.id),
    );
    const assignee = members.data?.find(
      (member) => member.user.id === card.assignees[0]?.userId,
    )?.user;
    return (
      <button
        key={card.id}
        type="button"
        title={card.title}
        aria-pressed={selectedId === card.id}
        className="calendar-pill"
        onClick={(event) => select(card, event.currentTarget)}
      >
        {firstLabel && (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: firstLabel.color }}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{card.title}</span>
        {assignee && (
          <UserAvatar user={assignee} className="size-5 text-[9px]" />
        )}
        {cardDueStatus(card.dueDate, now, timeZone) === 'OVERDUE' && (
          <span className="calendar-pill-status">
            <DueStatusBadge
              dueDate={card.dueDate}
              timeZone={timeZone}
              now={now}
            />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="board-view-workspace">
      <div className="board-view-toolbar">
        <BoardViews boardId={boardId} active="calendar" />
        <div className="flex items-center gap-2">
          <button
            className="min-h-11 rounded-lg border border-line px-3 py-2 text-sm"
            type="button"
            onClick={() => setMonth(today.slice(0, 7))}
          >
            Today
          </button>
          <button
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-3 py-2"
            type="button"
            aria-label="Previous month"
            onClick={() => changeMonth(-1)}
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
          </button>
          <h2
            className="min-w-32 text-center text-sm font-semibold text-ink"
            aria-live="polite"
          >
            {new Intl.DateTimeFormat('en', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))}
          </h2>
          <button
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-3 py-2"
            type="button"
            aria-label="Next month"
            onClick={() => changeMonth(1)}
          >
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
      {denied ? (
        <div>
          <LoadingState label="Checking board access…" />
          {active && (
            <button
              type="button"
              className="text-primary underline"
              onClick={() => apply({})}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="calendar-layout">
          <section aria-label="Calendar" className="calendar-panel">
            <div className="calendar-filters">
              <BoardFilter
                compact
                filters={filters}
                apply={apply}
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
            </div>
            {cards.isPending || columns.isPending || preferencesLoading ? (
              <LoadingState label="Loading calendar…" />
            ) : cards.isError || columns.isError ? (
              <ErrorState
                title="Could not load calendar"
                description="Check your connection and try again."
                onRetry={() => {
                  void cards.refetch();
                  void columns.refetch();
                }}
              />
            ) : (
              <>
                <div className="calendar-weekdays">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                    (day) => (
                      <div
                        key={day}
                        className="p-2 text-center text-xs font-medium text-muted"
                      >
                        {day}
                      </div>
                    ),
                  )}
                </div>
                <div className="calendar-grid">
                  {days.map((day) => {
                    const entries = groups.get(day) ?? [];
                    return (
                      <div
                        key={day}
                        className={`calendar-cell ${day === today ? 'bg-primary/10' : ''} ${day.slice(0, 7) !== month ? 'text-muted' : 'text-ink'}`}
                      >
                        <div className="mb-1 text-sm font-medium">
                          <time
                            dateTime={day}
                            aria-current={day === today ? 'date' : undefined}
                            aria-label={`${new Intl.DateTimeFormat('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}, ${entries.length} cards`}
                          >
                            {Number(day.slice(-2))}
                          </time>
                          <span className="ml-2 sm:hidden">
                            {new Intl.DateTimeFormat('en', {
                              weekday: 'long',
                              month: 'short',
                              timeZone: 'UTC',
                            }).format(new Date(`${day}T12:00:00Z`))}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {entries.slice(0, 2).map(pill)}
                          {entries.length > 2 && (
                            <details
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  event.currentTarget.open = false;
                                  event.currentTarget
                                    .querySelector('summary')
                                    ?.focus();
                                }
                              }}
                            >
                              <summary
                                aria-label={`${entries.length - 2} more cards on ${day}`}
                                className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary"
                              >
                                +{entries.length - 2} more
                              </summary>
                              <div className="mt-1 space-y-1">
                                {entries.slice(2).map(pill)}
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!days.some((day) => groups.has(day)) && (
                  <p className="p-4 text-sm text-muted">
                    {active
                      ? 'No scheduled cards match these filters in the displayed dates.'
                      : 'No cards are scheduled in the displayed dates.'}
                  </p>
                )}
                {unscheduled > 0 && (
                  <p className="p-3 text-xs text-muted">
                    {unscheduled}{' '}
                    {unscheduled === 1 ? 'card has' : 'cards have'} no due date
                    and {unscheduled === 1 ? 'is' : 'are'} not shown on the
                    calendar.
                  </p>
                )}
              </>
            )}
          </section>
          {selected && (
            <CalendarCardInspector
              key={selected.id}
              card={selected}
              boardName={boardName}
              columnName={
                columns.data?.find((column) => column.id === selected.columnId)
                  ?.name
              }
              labels={
                labels.data?.filter((label) =>
                  summary?.labelIds.includes(label.id),
                ) ?? []
              }
              members={canReadMembers ? (members.data ?? []) : []}
              timeZone={timeZone}
              dateFormat={dateFormat}
              now={now}
              closeButton={closeButton}
              onClose={closeInspector}
              onOpen={() => openCard(selected.id)}
            />
          )}
        </div>
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
