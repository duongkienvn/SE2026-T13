import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Dialog } from '../../../components/Dialog';
import { Pagination } from '../../../components/Pagination';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { isApiError } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import { toFormErrors } from '../../../lib/form-errors';
import { boardKeys } from '../../boards/query-keys';
import { useColumns } from '../../columns/hooks';
import { useArchivedCards, useRestoreCard } from '../hooks';
import type { Card } from '../types';

interface ArchivedCardsDialogProps {
  boardId: string;
  readOnly: boolean;
  onClose: () => void;
}

export function ArchivedCardsDialog({
  boardId,
  readOnly,
  onClose,
}: ArchivedCardsDialogProps) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Card>();
  const [notice, setNotice] = useState<string>();
  const query = useArchivedCards(boardId, page);
  const columns = useColumns(boardId);
  const restore = useRestoreCard(boardId);
  const submitting = useRef(false);
  const client = useQueryClient();
  const unavailable = [query.error, restore.error].some(
    (error) => isApiError(error) && [401, 403, 404].includes(error.status),
  );
  const data = unavailable ? undefined : query.data;

  useEffect(() => {
    if (unavailable) {
      setSelected(undefined);
      setNotice(undefined);
      void client.invalidateQueries({
        queryKey: boardKeys.detail(boardId),
        exact: true,
      });
    }
    if (readOnly) setSelected(undefined);
  }, [unavailable, readOnly, client, boardId]);
  useEffect(() => {
    if (data && data.meta.totalPages > 0 && page > data.meta.totalPages)
      setPage(data.meta.totalPages);
  }, [data, page]);

  const error = restore.isError
    ? isApiError(restore.error) && restore.error.code === 'CARD_NOT_ARCHIVED'
      ? 'This card was already restored. Refresh the list to see its current state.'
      : isApiError(restore.error) &&
          restore.error.code === 'CARD_COLUMN_UNAVAILABLE'
        ? 'The original column is unavailable. This card cannot be restored.'
        : toFormErrors(restore.error, {}).formError
    : undefined;

  if (selected && !readOnly && !unavailable) {
    return (
      <ConfirmDialog
        open
        title={`Restore “${selected.title}”?`}
        description="The card will return to the end of its original column. Its description, due date, assignees and comments will be kept."
        confirmLabel="Restore card"
        confirmVariant="primary"
        pendingLabel="Restoring…"
        pending={restore.isPending}
        error={error}
        onCancel={() => {
          restore.reset();
          setSelected(undefined);
        }}
        onConfirm={() => {
          if (submitting.current) return;
          submitting.current = true;
          void restore
            .mutateAsync(selected.id)
            .then(
              (card) => {
                setSelected(undefined);
                setNotice(`Card “${card.title}” restored.`);
              },
              () => undefined,
            )
            .finally(() => {
              submitting.current = false;
            });
        }}
      />
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Archived cards"
      size="wide"
      description="Archived cards stay on this board with their original data. Restore a card to bring it back to Kanban."
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {data
              ? `${data.meta.total} archived ${data.meta.total === 1 ? 'card' : 'cards'}`
              : 'Board archive'}
          </p>
          <Button variant="secondary" onClick={onClose} data-autofocus>
            Close
          </Button>
        </div>
        {notice && !unavailable && <Alert variant="success">{notice}</Alert>}
        {readOnly && (
          <Alert variant="error">
            This board is archived. Cards can be viewed but cannot be restored.
          </Alert>
        )}
        {unavailable ? (
          <ErrorState
            title="Archived cards unavailable"
            description="This board no longer exists, or you no longer have access to it."
          />
        ) : query.isPending ? (
          <LoadingState label="Loading archived cards…" />
        ) : query.isError ? (
          <ErrorState
            title="We couldn’t load archived cards"
            description="Check your connection and try again."
            onRetry={() => void query.refetch()}
          />
        ) : data?.items.length === 0 ? (
          <EmptyState
            title="No archived cards"
            description="Cards you archive from this board will appear here."
          />
        ) : (
          <ul aria-label="Archived cards" className="divide-y divide-line">
            {data?.items.map((card) => (
              <li
                key={card.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h3 className="font-semibold break-words text-ink">
                    {card.title}
                  </h3>
                  <p className="mt-1 text-sm break-words text-muted">
                    {columns.data?.find((column) => column.id === card.columnId)
                      ?.name ?? 'Original column'}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Archived
                    {card.archivedAt && (
                      <>
                        {' '}
                        ·{' '}
                        <time dateTime={card.archivedAt}>
                          {formatDateTime(card.archivedAt)}
                        </time>
                      </>
                    )}
                  </p>
                </div>
                {!readOnly && (
                  <Button
                    variant="secondary"
                    aria-label={`Restore ${card.title}`}
                    disabled={restore.isPending}
                    onClick={() => {
                      restore.reset();
                      setSelected(card);
                    }}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {data && !query.isError && (
          <Pagination
            label="Archived cards pages"
            page={page}
            pageCount={data.meta.totalPages}
            onChange={setPage}
          />
        )}
      </div>
    </Dialog>
  );
}
