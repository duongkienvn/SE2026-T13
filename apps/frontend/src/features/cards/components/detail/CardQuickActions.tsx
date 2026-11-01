import { Alert } from '../../../../components/Alert';
import { CopyIcon, HistoryIcon } from '../../../../components/icons';
import { isApiError } from '../../../../lib/api-client';
import { toFormErrors } from '../../../../lib/form-errors';
import {
  CARD_ARCHIVED,
  useArchiveCard,
  useDuplicateCard,
  useRestoreCard,
} from '../../hooks';
import type { Card } from '../../types';
import { ArchiveCardSection } from '../ArchiveCardSection';
import { CopyCardLink } from '../CopyCardLink';
import { CardRailGroup, railActionClass } from './CardDetailSection';

interface CardQuickActionsProps {
  card: Card;
  /** The board itself is archived or this viewer cannot edit it. */
  boardReadOnly: boolean;
  hasUnsavedChanges: boolean;
  /** Called after a successful archive, to discard drafts and close. */
  onArchived: () => void;
  onOpenCard?: (cardId: string) => void;
}

function restoreError(error: unknown): string | undefined {
  if (!error) return undefined;
  if (isApiError(error) && error.code === 'CARD_COLUMN_UNAVAILABLE')
    return 'Its column was deleted, so this card can’t be restored.';
  if (isApiError(error) && error.code === 'CARD_NOT_ARCHIVED')
    return 'This card is already active.';
  return toFormErrors(error, {}).formError;
}

function duplicateError(error: unknown): string | undefined {
  if (!error) return undefined;
  if (isApiError(error) && error.code === CARD_ARCHIVED)
    return 'Archived cards can’t be duplicated.';
  return toFormErrors(error, {}).formError;
}

/**
 * Real card commands only; each reflects the server state of the card and
 * board. Unsupported mockup actions (Move, Delete) are deliberately absent.
 */
export function CardQuickActions({
  card,
  boardReadOnly,
  hasUnsavedChanges,
  onArchived,
  onOpenCard,
}: CardQuickActionsProps) {
  const duplicate = useDuplicateCard(card.boardId, card.id);
  const archive = useArchiveCard(card.boardId, card.id);
  const restore = useRestoreCard(card.boardId);
  const canEdit = !boardReadOnly && !card.isArchived;
  const copy = duplicate.data;

  return (
    <CardRailGroup title="Actions">
      <div className="space-y-2">
        {canEdit && (
          <>
            <button
              type="button"
              className={railActionClass}
              disabled={duplicate.isPending}
              onClick={() => {
                restore.reset();
                duplicate.mutate();
              }}
            >
              <CopyIcon aria-hidden="true" className="size-4 text-muted" />
              {duplicate.isPending ? 'Duplicating…' : 'Duplicate'}
            </button>
            {copy && !duplicate.isPending && (
              <Alert variant="success">
                <p>
                  Copy created. Assignees, comments and attachments were not
                  copied
                  {hasUnsavedChanges ? ', nor your unsaved edits' : ''}.
                </p>
                {onOpenCard && (
                  <button
                    type="button"
                    className="mt-1 font-medium text-primary underline"
                    onClick={() => onOpenCard(copy.id)}
                  >
                    Open the copy
                  </button>
                )}
              </Alert>
            )}
            {duplicate.isError && (
              <Alert variant="error">{duplicateError(duplicate.error)}</Alert>
            )}
          </>
        )}
        <CopyCardLink boardId={card.boardId} cardId={card.id} />
        {canEdit && (
          <ArchiveCardSection
            pending={archive.isPending}
            hasUnsavedChanges={hasUnsavedChanges}
            error={
              archive.isError
                ? toFormErrors(archive.error, {}).formError
                : undefined
            }
            onArchive={() =>
              archive.mutate(undefined, { onSuccess: onArchived })
            }
            onCancel={() => archive.reset()}
          />
        )}
        {card.isArchived && !boardReadOnly && (
          <>
            <button
              type="button"
              className={railActionClass}
              disabled={restore.isPending}
              onClick={() => restore.mutate(card.id)}
            >
              <HistoryIcon aria-hidden="true" className="size-4 text-muted" />
              {restore.isPending ? 'Restoring…' : 'Restore card'}
            </button>
            {restore.isError && (
              <Alert variant="error">{restoreError(restore.error)}</Alert>
            )}
          </>
        )}
      </div>
    </CardRailGroup>
  );
}
