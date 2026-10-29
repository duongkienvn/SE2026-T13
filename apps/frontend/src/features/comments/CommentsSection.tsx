import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { TextAreaField } from '../../components/TextAreaField';
import { isApiError } from '../../lib/api-client';
import { toFormErrors } from '../../lib/form-errors';
import { formatRelativeTime } from '../../lib/format';
import { UserAvatar } from '../auth/components/UserAvatar';
import { useAuth } from '../auth/useAuth';
import type { BoardMember } from '../board-members/types';
import { COMMENTS_PAGE_LIMIT } from './api';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from './hooks';
import type { Comment } from './types';

const MAX_LENGTH = 2000;
const LABELS = { content: 'Comment' };

function contentError(content: string) {
  if (!content.trim()) return 'Enter a comment.';
  if (content.trim().length > MAX_LENGTH)
    return `Comment must be ${MAX_LENGTH} characters or fewer.`;
  return undefined;
}

function mutationError(error: unknown) {
  if (isApiError(error) && error.status === 409)
    return 'This board or card is archived. Comments can no longer be changed.';
  if (isApiError(error) && error.status === 401)
    return 'Your session has ended. Please sign in again.';
  return toFormErrors(error, LABELS).formError;
}

interface CommentsSectionProps {
  boardId: string;
  cardId: string;
  members: BoardMember[];
  readOnly: boolean;
  canReadMembers?: boolean;
}

/** A sibling of CardForm, never a form inside the card edit form. */
export function CommentsSection({
  boardId,
  cardId,
  members,
  readOnly,
  canReadMembers = true,
}: CommentsSectionProps) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const previousPageCount = useRef<
    { cardId: string; totalPages: number } | undefined
  >(undefined);
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [editContent, setEditContent] = useState('');
  const [confirmId, setConfirmId] = useState<string>();
  const [error, setError] = useState<string>();
  const query = useComments(boardId, cardId, page);
  const create = useCreateComment(boardId, cardId);
  const update = useUpdateComment(boardId, cardId);
  const remove = useDeleteComment(boardId, cardId);
  const busy = create.isPending || update.isPending || remove.isPending;
  const unavailable =
    isApiError(query.error) && [403, 404].includes(query.error.status);
  const pageData = unavailable ? undefined : query.data;
  const byId = new Map(members.map((member) => [member.user.id, member.user]));

  useEffect(() => {
    if (!pageData) return;
    const totalPages = Math.max(1, pageData.meta.totalPages);
    const previous = previousPageCount.current;
    previousPageCount.current = { cardId, totalPages };
    if (
      page > totalPages ||
      (previous?.cardId === cardId &&
        page === previous.totalPages &&
        totalPages > previous.totalPages)
    ) {
      setPage(totalPages);
    }
  }, [cardId, page, pageData]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || busy || contentError(content)) return;
    setError(undefined);
    try {
      const lastPage = Math.ceil(
        ((pageData?.meta.total ?? 0) + 1) / COMMENTS_PAGE_LIMIT,
      );
      await create.mutateAsync({ content: content.trim() });
      setContent('');
      setPage(Math.max(1, lastPage));
    } catch (cause) {
      const result = toFormErrors(cause, LABELS);
      setError(result.fieldErrors.content ?? mutationError(cause));
    }
  };

  const handleEdit = async (
    event: FormEvent<HTMLFormElement>,
    comment: Comment,
  ) => {
    event.preventDefault();
    if (
      readOnly ||
      busy ||
      contentError(editContent) ||
      editContent.trim() === comment.content
    )
      return;
    setError(undefined);
    try {
      await update.mutateAsync({
        commentId: comment.id,
        content: editContent.trim(),
      });
      setEditingId(undefined);
    } catch (cause) {
      const result = toFormErrors(cause, LABELS);
      setError(result.fieldErrors.content ?? mutationError(cause));
    }
  };

  const handleDelete = async (commentId: string) => {
    if (readOnly || busy) return;
    setError(undefined);
    try {
      await remove.mutateAsync(commentId);
      setConfirmId(undefined);
      if (page > 1 && pageData?.items.length === 1) setPage(page - 1);
    } catch (cause) {
      setError(mutationError(cause));
    }
  };

  return (
    <section
      aria-labelledby={`comments-${cardId}`}
      className="mt-6 border-t border-line pt-5"
    >
      <h3
        id={`comments-${cardId}`}
        className="text-base font-semibold text-ink"
      >
        Comments{pageData && ` (${pageData.meta.total})`}
      </h3>
      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <div className="mt-4">
        {query.isError && pageData && (
          <div className="mb-3">
            <Alert variant="error">
              Comments could not be refreshed.{' '}
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="rounded font-medium underline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Try again
              </button>
            </Alert>
          </div>
        )}
        {query.isPending ? (
          <LoadingState label="Loading comments…" />
        ) : query.isError && (!pageData || unavailable) ? (
          <ErrorState
            title={
              unavailable ? 'Comments unavailable' : 'We couldn’t load comments'
            }
            description={
              unavailable
                ? 'This card no longer exists, or you no longer have access to it.'
                : 'Check your connection and try again.'
            }
            onRetry={() => void query.refetch()}
          />
        ) : pageData?.items.length === 0 ? (
          <EmptyState
            title="No comments yet"
            description="Start the conversation on this card."
          />
        ) : (
          <ol
            aria-label="Comments"
            className="max-h-64 space-y-4 overflow-y-auto pr-1"
          >
            {pageData?.items.map((comment) => {
              const author =
                byId.get(comment.authorId) ??
                (user?.id === comment.authorId ? user : undefined);
              const name =
                author?.displayName ??
                (canReadMembers ? 'Former member' : 'Unknown member');
              const own = user?.id === comment.authorId;
              return (
                <li key={comment.id} className="flex gap-3 text-sm">
                  {author ? (
                    <UserAvatar user={author} className="size-8 text-xs" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="size-8 shrink-0 rounded-full bg-app"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold text-ink">{name}</span>
                      <time
                        dateTime={comment.createdAt}
                        className="text-xs text-muted"
                      >
                        {formatRelativeTime(comment.createdAt)}
                      </time>
                      {comment.updatedAt !== comment.createdAt && (
                        <span className="text-xs text-muted">(edited)</span>
                      )}
                    </div>
                    {editingId === comment.id && !readOnly ? (
                      <form
                        onSubmit={(event) => void handleEdit(event, comment)}
                        className="mt-2 space-y-2"
                      >
                        <TextAreaField
                          label="Edit comment"
                          rows={3}
                          value={editContent}
                          maxLength={MAX_LENGTH + 1}
                          onChange={(event) => {
                            setEditContent(event.target.value);
                            setError(undefined);
                          }}
                          error={contentError(editContent)}
                        />
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            disabled={
                              busy ||
                              !!contentError(editContent) ||
                              editContent.trim() === comment.content
                            }
                          >
                            Save comment
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setEditingId(undefined)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-app px-3 py-2 text-ink">
                        {comment.content}
                      </p>
                    )}
                    {own &&
                      !readOnly &&
                      editingId !== comment.id &&
                      (confirmId === comment.id ? (
                        <div
                          role="group"
                          aria-label="Delete comment"
                          className="mt-2 space-y-2"
                        >
                          <p className="text-sm text-ink">
                            Delete this comment? This cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="danger"
                              disabled={busy}
                              onClick={() => void handleDelete(comment.id)}
                            >
                              {remove.isPending
                                ? 'Deleting…'
                                : 'Delete comment'}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => setConfirmId(undefined)}
                            >
                              Keep comment
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 flex gap-3">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setError(undefined);
                              setEditContent(comment.content);
                              setEditingId(comment.id);
                            }}
                            className="rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                          >
                            Edit comment
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setError(undefined);
                              setConfirmId(comment.id);
                            }}
                            className="rounded text-xs text-danger hover:underline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                          >
                            Delete comment
                          </button>
                        </div>
                      ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {pageData && (
          <Pagination
            label="Comments pages"
            page={page}
            pageCount={pageData.meta.totalPages}
            onChange={(next) => {
              setPage(next);
              setEditingId(undefined);
              setConfirmId(undefined);
              setError(undefined);
            }}
            className="mt-3"
          />
        )}
      </div>
      {!readOnly && !unavailable && user && (
        <form
          onSubmit={(event) => void handleCreate(event)}
          className="mt-5 space-y-2 border-t border-line pt-4"
        >
          <TextAreaField
            label="Write a comment"
            rows={2}
            value={content}
            maxLength={MAX_LENGTH + 1}
            onChange={(event) => {
              setContent(event.target.value);
              setError(undefined);
            }}
            error={
              content && contentError(content)
                ? contentError(content)
                : undefined
            }
            hint={`Up to ${MAX_LENGTH} characters.`}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !!contentError(content)}>
              {create.isPending ? 'Posting…' : 'Post comment'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
