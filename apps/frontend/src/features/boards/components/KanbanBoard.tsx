import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/Button';
import { ColumnsIcon, PlusIcon } from '../../../components/icons';
import { ErrorState, LoadingState } from '../../../components/states';
import { isApiError } from '../../../lib/api-client';
import { useBoardMembers } from '../../board-members/hooks';
import type { MemberUser } from '../../board-members/types';
import { CardDetailDialog } from '../../cards/components/CardDetailDialog';
import { useCards } from '../../cards/hooks';
import { previewSummaryFilters } from '../../cards/preview-summary-cache';
import {
  BoardFilter,
  useBoardFilters,
  useFilteredCards,
  usePreviewSummaries,
} from '../../cards/board-filter';
import { PreviewContext } from '../../cards/components/preview-context';
import { useDatePreferences } from '../../cards/components/detail/CardDates';
import { useLabelCatalog } from '../../labels/hooks';
import { useCardRoute } from '../../cards/useCardRoute';
import type { Card } from '../../cards/types';
import { groupCardsByColumn } from '../../cards/ordering';
import {
  CreateColumnDialog,
  RenameColumnDialog,
} from '../../columns/components/ColumnFormDialog';
import { DeleteColumnDialog } from '../../columns/components/DeleteColumnDialog';
import type { ColumnActions } from '../../columns/components/KanbanColumn';
import { useColumns } from '../../columns/hooks';
import type { Column } from '../../columns/types';
import { boardKeys } from '../query-keys';
import { KanbanDndBoard } from './KanbanDndBoard';
import { BoardViews } from './BoardViews';

interface KanbanBoardProps {
  boardId: string;
  /** Archived boards can be viewed but not changed. */
  readOnly: boolean;
  canReadMembers?: boolean;
  /** Shown as the card's context in Card Detail. */
  boardName?: string;
}

type OpenDialog =
  | { kind: 'create-column' }
  | { kind: 'rename-column'; column: Column }
  | { kind: 'delete-column'; column: Column };

/** The board's columns and active cards, side by side. */
export function KanbanBoard({
  boardId,
  readOnly,
  canReadMembers = true,
  boardName,
}: KanbanBoardProps) {
  const { cardId, openCard, closeCard } = useCardRoute(boardId);
  const columns = useColumns(boardId);
  const { filters, apply, active } = useBoardFilters();
  const allCards = useCards(boardId, { enabled: !active });
  const [page, setPage] = useState(1);
  const filteredCards = useFilteredCards(boardId, filters, page, active);
  const cards = active
    ? { ...filteredCards, data: filteredCards.data?.items }
    : allCards;
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [filterKey, boardId]);
  useEffect(() => {
    if (
      active &&
      filteredCards.data &&
      page > Math.max(1, filteredCards.data.meta.totalPages)
    )
      setPage(Math.max(1, filteredCards.data.meta.totalPages));
  }, [active, filteredCards.data, page]);
  const labels = useLabelCatalog(boardId);
  const { timeZone, dateFormat } = useDatePreferences();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const current = Date.now();
    const nextMinute = 60_000 - (current % 60_000);
    const nextDue = (cards.data ?? []).reduce((delay, card) => {
      const remaining = card.dueDate
        ? Date.parse(card.dueDate) - current + 1
        : Infinity;
      return remaining > 0 ? Math.min(delay, remaining) : delay;
    }, nextMinute);
    const timer = setTimeout(() => setNow(Date.now()), nextDue);
    return () => clearTimeout(timer);
  }, [cards.data, now]);
  const summaries = usePreviewSummaries(
    boardId,
    cards.data?.map((card) => card.id) ?? [],
  );
  // Only for assignee names and avatars: the board still shows without them.
  const members = useBoardMembers(boardId, { enabled: canReadMembers });
  const queryClient = useQueryClient();
  useEffect(() => {
    if (active && filters.dueStatus)
      void queryClient.invalidateQueries({
        queryKey: [...boardKeys.cards(boardId), 'filtered'],
      });
  }, [active, boardId, filters.dueStatus, now, queryClient]);
  const [dialog, setDialog] = useState<OpenDialog>();

  // 403/404 here means access was lost or the board is gone. Cached columns
  // and cards would keep it on screen, so refetch the board itself: the page
  // then shows "Board not found". Only the board (`exact`), not this data.
  const lostAccess = [
    columns.error,
    active ? null : cards.error,
    summaries.error,
    labels.error,
  ].some(
    (error) =>
      isApiError(error) && (error.status === 403 || error.status === 404),
  );
  useEffect(() => {
    if (
      !lostAccess &&
      !(
        active &&
        isApiError(cards.error) &&
        [403, 404].includes(cards.error.status)
      )
    )
      return;
    void queryClient.invalidateQueries({
      queryKey: boardKeys.detail(boardId),
      exact: true,
    });
  }, [lostAccess, active, cards.error, boardId, queryClient]);
  const filterDenied =
    active &&
    isApiError(cards.error) &&
    [403, 404].includes(cards.error.status);
  const closeDialog = () => setDialog(undefined);

  const membersById = useMemo(
    () =>
      new Map<string, MemberUser>(
        (canReadMembers ? (members.data ?? []) : []).map((member) => [
          member.user.id,
          member.user,
        ]),
      ),
    [members.data, canReadMembers],
  );
  const groups = useMemo(
    () => groupCardsByColumn(columns.data ?? [], cards.data ?? []),
    [columns.data, cards.data],
  );
  const columnActions: ColumnActions | undefined = readOnly
    ? undefined
    : {
        onRename: (column) => setDialog({ kind: 'rename-column', column }),
        onDelete: (column) => setDialog({ kind: 'delete-column', column }),
      };
  const openCreateColumn = () => setDialog({ kind: 'create-column' });
  const openedCard = cards.data?.find((card) => card.id === cardId);

  let content;
  let columnLayout = false;
  if (filterDenied) {
    content = (
      <ErrorState
        title="We couldn't load these filters"
        description="A selected label or member may no longer be available. Clear the filters or try again."
        onRetry={() => void cards.refetch()}
      />
    );
  } else if (lostAccess) {
    content = <LoadingState label="Checking board access..." />;
  } else if (columns.isPending || cards.isPending) {
    content = <LoadingState label="Loading columns and cards…" />;
  } else if (!columns.data || !cards.data) {
    // A failed background refresh keeps the loaded board on screen.
    content = (
      <ErrorState
        title="We couldn't load this board's cards"
        description="Check your connection and try again."
        onRetry={() => {
          if (columns.isError) void columns.refetch();
          if (cards.isError) void cards.refetch();
        }}
      />
    );
  } else if (groups.length === 0) {
    content = (
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface/95 p-5 text-center shadow-card">
        <ColumnsIcon
          aria-hidden="true"
          className="mx-auto mb-3 size-7 text-primary"
        />
        <h2 className="text-lg font-semibold text-ink">No columns yet</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {readOnly
            ? 'This board is read only. No columns are available yet.'
            : 'Add a column to start organizing this board.'}
        </p>
        {!readOnly && (
          <Button className="mt-4" onClick={openCreateColumn}>
            <PlusIcon aria-hidden="true" className="size-4" />
            Add column
          </Button>
        )}
      </div>
    );
  } else {
    columnLayout = true;
    content = (
      <KanbanDndBoard
        boardId={boardId}
        groups={groups}
        filterActive={active}
        members={membersById}
        actions={columnActions}
        onOpenCard={(card: Card) => openCard(card.id)}
        trailing={
          !readOnly && (
            <button
              type="button"
              onClick={openCreateColumn}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-surface/95 px-4 text-sm font-medium text-primary shadow-card hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              <PlusIcon aria-hidden="true" className="size-4.5" />
              Add column
            </button>
          )
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-3 md:px-6">
        <div className="mb-3 w-fit rounded-xl border border-line bg-surface/90 p-2">
          <BoardViews boardId={boardId} active="board" />
        </div>
        {!lostAccess && !filterDenied && (
          <BoardFilter
            filters={filters}
            apply={apply}
            labels={labels.data ?? []}
            labelsPending={labels.isPending}
            labelsError={labels.isError}
            membersPending={canReadMembers && members.isPending}
            membersError={canReadMembers && members.isError}
            retryLabels={() => void labels.refetch()}
            retryMembers={() => void members.refetch()}
            members={canReadMembers ? (members.data ?? []) : []}
          />
        )}
        {filterDenied && (
          <button
            type="button"
            className="mb-3 self-start text-sm text-primary underline"
            onClick={() => apply({})}
          >
            Clear filters
          </button>
        )}
        {active && !lostAccess && !filterDenied && (
          <p
            className="mb-3 rounded-lg bg-surface/95 p-2 text-sm text-muted"
            role="status"
          >
            {cards.isPending
              ? 'Loading matches...'
              : cards.isError
                ? 'Could not load matches'
                : `${filteredCards.data?.meta.total ?? 0} matching cards`}
            . Column counts show cards on this page. Reordering is disabled
            while filters are active.{' '}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => apply({})}
            >
              Clear filters
            </button>
          </p>
        )}
        {active &&
          !lostAccess &&
          !filterDenied &&
          filteredCards.data &&
          filteredCards.data.meta.totalPages > 1 && (
            <nav
              className="mb-3 flex items-center gap-3 rounded-lg bg-surface/95 p-2 text-sm"
              aria-label="Card results pages"
            >
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded border border-line px-2 py-1 disabled:opacity-50"
              >
                Previous
              </button>
              <span>
                Page {page} of {filteredCards.data.meta.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= filteredCards.data.meta.totalPages}
                onClick={() => setPage(page + 1)}
                className="rounded border border-line px-2 py-1 disabled:opacity-50"
              >
                Next
              </button>
            </nav>
          )}
        {summaries.isError && !lostAccess && !filterDenied && (
          <p
            role="alert"
            className="mb-2 rounded-lg bg-surface/95 p-2 text-sm text-danger"
          >
            Card preview details could not be loaded.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => void summaries.refetch()}
            >
              Retry
            </button>
          </p>
        )}
      </div>
      <PreviewContext.Provider
        value={{
          summaries: new Map(
            (summaries.data ?? []).map((item) => [item.cardId, item]),
          ),
          labels: labels.data ?? [],
          timeZone,
          dateFormat,
          now,
        }}
      >
        <div
          className={
            columnLayout
              ? 'min-h-0 flex-1'
              : 'grid min-h-0 flex-1 place-items-center px-4 pb-4 [&>div]:w-full [&>div]:max-w-sm [&_[role=status]]:rounded-xl [&_[role=status]]:bg-surface/95'
          }
        >
          {content}
        </div>
      </PreviewContext.Provider>
      {!lostAccess &&
        !filterDenied &&
        !readOnly &&
        dialog?.kind === 'create-column' && (
          <CreateColumnDialog boardId={boardId} open onClose={closeDialog} />
        )}
      {!lostAccess &&
        !filterDenied &&
        !readOnly &&
        dialog?.kind === 'rename-column' && (
          <RenameColumnDialog
            column={dialog.column}
            open
            onClose={closeDialog}
          />
        )}
      {!lostAccess &&
        !filterDenied &&
        !readOnly &&
        dialog?.kind === 'delete-column' && (
          <DeleteColumnDialog
            column={dialog.column}
            open
            onClose={closeDialog}
          />
        )}
      {cardId && !lostAccess && !filterDenied && (
        <CardDetailDialog
          key={`${boardId}:${cardId}`}
          boardId={boardId}
          cardId={cardId}
          initialCard={openedCard}
          columnName={
            columns.data?.find((column) => column.id === openedCard?.columnId)
              ?.name
          }
          members={canReadMembers ? (members.data ?? []) : []}
          canReadMembers={canReadMembers}
          boardName={boardName}
          boardReadOnly={readOnly}
          onClose={() => {
            closeCard();
            void queryClient.invalidateQueries({
              queryKey: [...boardKeys.cards(boardId), 'filtered'],
            });
            void queryClient.invalidateQueries(
              previewSummaryFilters(boardId, cardId),
            );
          }}
          onOpenCard={openCard}
        />
      )}
    </div>
  );
}
