import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StarterBoardRemovalPreview } from '@kanban/shared';
import { Dialog } from '../../../components/Dialog';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/TextField';
import { LoadingState } from '../../../components/states';
import { isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { getSampleBoardRemoval, removeSampleBoard } from '../api';
import { boardKeys } from '../query-keys';
import { workspaceKeys } from '../../workspaces/query-keys';
import { revokeBoardAccess } from '../revoke-board-access';

/** Keep the reviewed snapshot immutable until the user explicitly reviews again. */
export function RemoveSampleBoardDialog({
  boardId,
  onClose,
  onRemoved,
}: {
  boardId: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const [review, setReview] = useState<StarterBoardRemovalPreview>();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setReview(undefined);
    setConfirmation('');
    setError('');
    void runAuthorized((token) =>
      getSampleBoardRemoval(token, boardId, controller.signal),
    )
      .then((data) => {
        if (!controller.signal.aborted && scope.isCurrent()) setReview(data);
      })
      .catch((reason) => {
        if (!controller.signal.aborted && scope.isCurrent())
          setError(
            isApiError(reason)
              ? reason.message
              : 'Could not review sample removal. Try again.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted && scope.isCurrent()) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, boardId, runAuthorized, scope]);
  const removal = useMutation({
    mutationFn: () => {
      if (!review) throw new Error('Review sample removal first');
      return runAuthorized((token) =>
        removeSampleBoard(token, boardId, {
          version: review.version,
          confirmation,
        }),
      );
    },
    onSuccess: () => {
      if (!scope.isCurrent()) return;
      revokeBoardAccess(client, boardId);
      void client.invalidateQueries({ queryKey: boardKeys.lists() });
      void client.invalidateQueries({ queryKey: workspaceKeys.all });
      onRemoved();
    },
    onError: (reason) => {
      if (!scope.isCurrent()) return;
      setError(
        isApiError(reason)
          ? reason.message
          : 'Could not remove the sample board. Try again.',
      );
      setConfirmation('');
      if (isApiError(reason) && [403, 404].includes(reason.status)) {
        setReview(undefined);
        void client.invalidateQueries({ queryKey: boardKeys.detail(boardId) });
      }
    },
  });
  return (
    <Dialog
      open
      title="Remove Sample Board"
      onClose={onClose}
      dismissible={!removal.isPending}
    >
      <p className="mb-4 text-sm text-muted">
        Permanently remove this sample Board and all of its Columns, Cards,
        labels, checklists, comments and attachments. This cannot be undone.
        Stored files are queued for secure cleanup.
      </p>
      {loading && <LoadingState label="Checking sample board…" />}
      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
          <button
            type="button"
            className="mt-2 text-sm text-primary underline"
            disabled={removal.isPending}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Review again
          </button>
        </div>
      )}
      {review && (
        <>
          <p className="mb-3 text-sm font-medium break-words">
            {review.boardName}
          </p>
          {review.isCustomized && (
            <div className="mb-4">
              <Alert variant="error">
                This Board has been changed since it was created. Removing it
                will permanently delete your customized work and any content you
                added.
              </Alert>
            </div>
          )}
          <TextField
            label={`Type ${review.confirmation} to confirm`}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={removal.isPending}
          />
        </>
      )}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          data-autofocus
          onClick={onClose}
          disabled={removal.isPending}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={
            !review ||
            confirmation !== review.confirmation ||
            removal.isPending ||
            !!error
          }
          onClick={() => removal.mutate()}
        >
          {removal.isPending ? 'Removing…' : 'Remove Sample Board'}
        </Button>
      </div>
    </Dialog>
  );
}
