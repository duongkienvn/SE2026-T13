import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { LoadingState } from '../../../components/states';
import { isApiError } from '../../../lib/api-client';
import { toFormErrors } from '../../../lib/form-errors';
import { formatRelativeTime } from '../../../lib/format';
import type { BoardMember } from '../../board-members/types';
import { boardKeys } from '../../boards/query-keys';
import { CommentsSection } from '../../comments/CommentsSection';
import { useArchiveCard, useCard, useUpdateCard } from '../hooks';
import type { Card } from '../types';
import { ArchiveCardSection } from './ArchiveCardSection';
import { CardAssignees } from './CardAssignees';
import { CardForm } from './CardForm';
import { CopyCardLink } from './CopyCardLink';
import { cardDraftKey } from '../card-draft';

interface CardDetailDialogProps {
  boardId: string;
  cardId: string;
  /** The card as shown on the board, so the dialog opens without waiting. */
  initialCard?: Card;
  columnName?: string;
  members: BoardMember[];
  canReadMembers?: boolean;
  /** The board is archived: everything is view-only. */
  boardReadOnly: boolean;
  onClose: () => void;
}

export function CardDetailDialog({
  boardId,
  cardId,
  initialCard,
  columnName,
  members,
  canReadMembers = true,
  boardReadOnly,
  onClose,
}: CardDetailDialogProps) {
  const query = useCard(boardId, cardId, initialCard);
  const update = useUpdateCard(boardId, cardId);
  const archive = useArchiveCard(boardId, cardId);
  const gone =
    isApiError(query.error) && [400, 403, 404].includes(query.error.status);
  const card =
    gone || (!initialCard && !query.isFetchedAfterMount)
      ? undefined
      : (query.data ?? initialCard);
  const busy = update.isPending || archive.isPending;
  const client = useQueryClient();
  const close = () => {
    if (!card)
      client.removeQueries({
        queryKey: cardDraftKey(boardId, cardId),
        exact: true,
      });
    onClose();
  };

  useEffect(() => {
    if (!gone) return;
    client.removeQueries({
      queryKey: cardDraftKey(boardId, cardId),
      exact: true,
    });
    void client.cancelQueries({
      queryKey: [...boardKeys.card(boardId, cardId), 'comments'],
    });
    client.removeQueries({
      queryKey: [...boardKeys.card(boardId, cardId), 'comments'],
    });
    client
      .getQueryCache()
      .find({ queryKey: boardKeys.card(boardId, cardId), exact: true })
      ?.setState({ data: undefined });
    void client.invalidateQueries({
      queryKey: boardKeys.detail(boardId),
      exact: true,
    });
  }, [gone, client, boardId, cardId]);

  if (!card) {
    return (
      <Dialog open onClose={close} title="Card" size="wide" fullscreenOnMobile>
        {!gone && (query.isPending || query.isFetching) ? (
          <LoadingState label="Loading card…" />
        ) : (
          <div className="space-y-5">
            <Alert variant="error">
              {gone
                ? 'This card no longer exists, or you no longer have access to it.'
                : 'We couldn’t load this card. Check your connection and try again.'}
            </Alert>
            <div className="flex flex-wrap justify-end gap-3">
              {!gone && (
                <Button
                  variant="secondary"
                  onClick={() => void query.refetch()}
                >
                  Try again
                </Button>
              )}
              <Button variant="secondary" onClick={close}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    );
  }

  const readOnly = boardReadOnly || card.isArchived;
  const meta = [
    columnName && `In ${columnName}`,
    `Created ${formatRelativeTime(card.createdAt)}`,
    `Updated ${formatRelativeTime(card.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog
      open
      onClose={close}
      title={card.title}
      description={meta}
      size="wide"
      fullscreenOnMobile
      dismissible={!busy}
    >
      <div className="mb-5 flex justify-end">
        <Button variant="secondary" onClick={close} disabled={busy}>
          Close card
        </Button>
      </div>
      {query.isError && !gone && (
        <Alert variant="error">
          We couldn’t refresh this card. Your edits are still here.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </Alert>
      )}
      {card.isArchived && (
        <div className="mb-5">
          <Alert variant="error">
            This card is archived. It can be viewed but no longer changed.
          </Alert>
        </div>
      )}
      <CardForm
        key={card.id}
        boardId={boardId}
        card={card}
        readOnly={readOnly}
        pending={update.isPending}
        onSubmit={(patch) => update.mutateAsync(patch)}
        onClose={close}
        side={
          <>
            <CopyCardLink boardId={boardId} cardId={cardId} />
            <CardAssignees card={card} members={members} readOnly={readOnly} />
            {!readOnly && (
              <ArchiveCardSection
                pending={archive.isPending}
                error={
                  archive.isError
                    ? toFormErrors(archive.error, {}).formError
                    : undefined
                }
                onArchive={() =>
                  archive.mutate(undefined, { onSuccess: close })
                }
                onCancel={() => archive.reset()}
              />
            )}
          </>
        }
      />
      <CommentsSection
        key={`${boardId}:${cardId}`}
        boardId={boardId}
        cardId={cardId}
        members={members}
        readOnly={readOnly}
        canReadMembers={canReadMembers}
      />
    </Dialog>
  );
}
