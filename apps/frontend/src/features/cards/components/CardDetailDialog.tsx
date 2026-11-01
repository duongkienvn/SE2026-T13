import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { CloseIcon, PencilIcon } from '../../../components/icons';
import { LoadingState } from '../../../components/states';
import { isApiError } from '../../../lib/api-client';
import { formatRelativeTime } from '../../../lib/format';
import type { BoardMember } from '../../board-members/types';
import { boardKeys } from '../../boards/query-keys';
import { CommentsSection } from '../../comments/CommentsSection';
import {
  CardLabelBadges,
  CardLabels,
} from '../../labels/components/CardLabels';
import { CardAttachments } from '../attachments/CardAttachments';
import {
  cardDraftKey,
  DirtyRegistryContext,
  isDraftDirty,
  useCardDraft,
  useDirtyRegistry,
  useLeaveGuard,
} from '../card-draft';
import { CardChecklists } from '../checklists/CardChecklists';
import { useCard } from '../hooks';
import type { Card } from '../types';
import { CardAssignees } from './CardAssignees';
import { CardDates } from './detail/CardDates';
import { CardQuickActions } from './detail/CardQuickActions';
import { DescriptionSection, TitleEditor } from './detail/CardTextEditors';

interface CardDetailDialogProps {
  boardId: string;
  cardId: string;
  /** The card as shown on the board, so the dialog opens without waiting. */
  initialCard?: Card;
  columnName?: string;
  boardName?: string;
  members: BoardMember[];
  canReadMembers?: boolean;
  /** The board is archived or read-only for this viewer. */
  boardReadOnly: boolean;
  onClose: () => void;
  /** Opens another card of this board, e.g. a fresh duplicate. */
  onOpenCard?: (cardId: string) => void;
}

const headerButton =
  'grid size-10 place-items-center rounded-lg text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary';

/**
 * Card Detail V2 (P3-08): a route-linked dialog, full screen on phones. The
 * main column holds the content sections (description, checklists,
 * attachments, comments); the rail holds people, labels, dates and actions.
 */
export function CardDetailDialog({
  boardId,
  cardId,
  initialCard,
  columnName,
  boardName,
  members,
  canReadMembers = true,
  boardReadOnly,
  onClose,
  onOpenCard,
}: CardDetailDialogProps) {
  const query = useCard(boardId, cardId, initialCard);
  const gone =
    isApiError(query.error) && [400, 403, 404].includes(query.error.status);
  const card =
    gone || (!initialCard && !query.isFetchedAfterMount)
      ? undefined
      : (query.data ?? initialCard);
  const client = useQueryClient();
  const { draft, update, clear } = useCardDraft(boardId, cardId);
  const registry = useDirtyRegistry();
  const dirty = isDraftDirty(draft) || registry.anyDirty;
  const { blocker, release } = useLeaveGuard(dirty);
  const discardPrompt = useRef<HTMLDivElement>(null);

  const discard = () => {
    clear();
    registry.reset();
    release();
  };
  const close = () => {
    if (!card)
      client.removeQueries({
        queryKey: cardDraftKey(boardId, cardId),
        exact: true,
      });
    onClose();
  };

  useEffect(() => {
    if (blocker.state === 'blocked') discardPrompt.current?.focus();
  }, [blocker.state]);

  useEffect(() => {
    if (!gone) return;
    // Access is gone: no unsent text or protected data stays around.
    clear();
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
  }, [gone, client, boardId, cardId, clear]);

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
    // "In Progress in Frontend Development", as in the approved reference.
    columnName && boardName
      ? `${columnName} in ${boardName}`
      : columnName && `In ${columnName}`,
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
      size="detail"
      fullscreenOnMobile
      headerActions={
        <>
          {!readOnly && !draft.title && (
            <button
              type="button"
              aria-label="Edit title"
              className={headerButton}
              onClick={() =>
                update('title', { base: card.title, value: card.title })
              }
            >
              <PencilIcon aria-hidden="true" className="size-5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Close card"
            className={headerButton}
            onClick={close}
          >
            <CloseIcon aria-hidden="true" className="size-5" />
          </button>
        </>
      }
    >
      <DirtyRegistryContext.Provider value={registry.report}>
        <div className="space-y-4">
          {blocker.state === 'blocked' && (
            <div
              ref={discardPrompt}
              tabIndex={-1}
              aria-label="Unsaved card changes"
              className="focus:outline-none"
            >
              <Alert variant="error">
                <p>You have unsaved card changes. Discard them and leave?</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={() => blocker.reset()}>
                    Keep editing
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      discard();
                      blocker.proceed();
                    }}
                  >
                    Discard changes
                  </Button>
                </div>
              </Alert>
            </div>
          )}
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
            <Alert variant="error">
              This card is archived. It can be viewed but no longer changed.
            </Alert>
          )}
          {!card.isArchived && boardReadOnly && (
            <p className="text-sm text-muted">
              View only: you can read this card but not change it.
            </p>
          )}
          <CardLabelBadges boardId={boardId} cardId={cardId} />
        </div>

        <div className="mt-6 grid gap-x-8 gap-y-8 md:grid-cols-[minmax(0,1fr)_15rem] lg:grid-cols-[minmax(0,1fr)_16.5rem]">
          <div className="min-w-0 space-y-8">
            <TitleEditor
              card={card}
              draft={draft.title}
              onDraft={(value) => update('title', value)}
              readOnly={readOnly}
            />
            <DescriptionSection
              card={card}
              draft={draft.description}
              onDraft={(value) => update('description', value)}
              readOnly={readOnly}
            />
            <CardChecklists
              key={`checklists:${cardId}`}
              boardId={boardId}
              cardId={cardId}
              readOnly={readOnly}
            />
            <CardAttachments
              key={`attachments:${cardId}`}
              boardId={boardId}
              cardId={cardId}
              readOnly={readOnly}
            />
          </div>
          <aside
            aria-label="Card details"
            className="min-w-0 space-y-6 md:col-start-2 md:row-span-2 md:row-start-1 md:border-l md:border-line md:pl-6"
          >
            <CardAssignees card={card} members={members} readOnly={readOnly} />
            <CardLabels
              boardId={boardId}
              cardId={cardId}
              cardReadOnly={readOnly}
              boardReadOnly={boardReadOnly}
            />
            <CardDates
              card={card}
              draft={draft.dates}
              onDraft={(value) => update('dates', value)}
              readOnly={readOnly}
            />
            <CardQuickActions
              card={card}
              boardReadOnly={boardReadOnly}
              hasUnsavedChanges={dirty}
              onOpenCard={onOpenCard}
              onArchived={() => {
                discard();
                close();
              }}
            />
          </aside>
          <div className="min-w-0 md:col-start-1">
            <CommentsSection
              key={`${boardId}:${cardId}`}
              boardId={boardId}
              cardId={cardId}
              members={members}
              readOnly={readOnly}
              canReadMembers={canReadMembers}
            />
          </div>
        </div>
      </DirtyRegistryContext.Provider>
    </Dialog>
  );
}
