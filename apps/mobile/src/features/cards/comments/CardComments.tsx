import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePreventRemove, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../../infrastructure/api/errors';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import { subscribeIncomingLinks } from '../../../navigation/incoming-link';
import { destinationPath } from '../../../navigation/routes';
import {
  Avatar,
  Button,
  ConfirmDialog,
  Skeleton,
  Surface,
  UnsavedChangesPrompt,
  radius,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { hasExplicitBoardMembership } from '../../boards/members';
import { BoardMemberAvatar } from '../../boards/members/BoardMemberAvatar';
import { isAccessDenied } from '../../boards/kanban-api';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../../workspaces/status';
import type { CardDetailSectionProps } from '../detail/sections';
import { createCommentsApi, type Comment } from './api';
import { useCommentMutation, useComments } from './hooks';
import { MentionComposer, composerStyles } from './MentionComposer';
import { contentError, emptyDraft, type MentionDraft } from './mentions';
import { canWriteComments, uncertainCommentWrite } from './queries';

function Note({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  const c = useTheme();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[
        typography.supporting,
        { color: error ? c.danger : c.textSecondary },
      ]}
    >
      {children}
    </Text>
  );
}
function MentionText({
  comment,
  allowed,
}: {
  comment: Comment;
  allowed: boolean;
}) {
  const c = useTheme();
  let cursor = 0;
  const parts: ReactNode[] = [];
  if (allowed)
    for (const span of comment.mentions) {
      parts.push(comment.content.slice(cursor, span.start));
      parts.push(
        <Text
          key={span.start}
          style={{ color: c.primaryPressed, fontWeight: '600' }}
        >
          {comment.content.slice(span.start, span.end)}
        </Text>,
      );
      cursor = span.end;
    }
  parts.push(comment.content.slice(cursor));
  return (
    <Text
      selectable
      dataDetectorType="none"
      style={[typography.body, { color: c.text }]}
    >
      {parts}
    </Text>
  );
}

function useCommentLeave(
  dirty: boolean,
  pending: boolean,
  active: boolean,
  path: string,
  clear: () => void,
) {
  const router = useRouter();
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const latest = useRef({ dirty, pending, active, clear });
  latest.current = { dirty, pending, active, clear };
  const disable = usePreventRemove(
    active && (dirty || pending),
    ({ repeat }) => {
      if (!pending) setLeave(() => repeat);
    },
  );
  useEffect(
    () =>
      subscribeIncomingLinks((destination) => {
        const state = latest.current;
        const target = destinationPath(destination);
        if (
          !state.active ||
          target === path ||
          (!state.dirty && !state.pending)
        )
          return;
        if (!state.pending) setLeave(() => () => router.push(target));
        return path;
      }),
    [path, router],
  );
  return {
    visible: active && !!leave,
    keep: () => setLeave(null),
    discard: () => {
      if (pending) return;
      clear();
      disable();
      const next = leave;
      setLeave(null);
      next?.();
    },
  };
}

export function CardComments({ context }: CardDetailSectionProps) {
  const data = useMobileData();
  const c = useTheme();
  const online = useWorkspaceOnline();
  const [page, setPage] = useState(1);
  const state = useComments(context, page);
  const { comments, members, roster, denied, available } = state;
  const [draft, setDraft] = useState<MentionDraft>(emptyDraft);
  const [editing, setEditing] = useState<{
    original: Comment;
    draft: MentionDraft;
    page: number;
  }>();
  const [deleting, setDeleting] = useState<Comment>();
  const [error, setError] = useState<unknown>();
  const [errorAt, setErrorAt] = useState(0);
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const explicit = hasExplicitBoardMembership(context.board);
  const eligible =
    context.canEdit && canWriteComments(context.board, context.card);
  const writable = eligible && !denied;
  const mutation = useCommentMutation(context, writable);
  const busy = mutation.pending;
  const retryReady = useWorkspaceRetryReady(
    comments.error,
    comments.errorUpdatedAt,
  );
  const writeRetry = useWorkspaceRetryReady(error, errorAt);
  const rosterError = roster.find((query) => query.isError);
  const rosterRetry = useWorkspaceRetryReady(
    rosterError?.error,
    rosterError?.errorUpdatedAt ?? 0,
  );
  const rosterBusy = roster.some((query) => query.isFetching);
  const candidates = members
    .filter(({ member }) => !member.user.isDeleted)
    .map(({ member, page }) => ({
      userId: member.user.id,
      displayName: member.user.displayName,
      page,
      detail: member.user.email,
    }));
  const pageData = isAccessDenied(comments.error) ? undefined : comments.data;
  const rows = pageData?.data ?? [];
  const byId = new Map(members.map((row) => [row.member.user.id, row]));
  const mentionPages = (value: MentionDraft) => [
    ...new Set(
      value.spans.flatMap((span) => {
        const page = byId.get(span.userId)?.page;
        return page === undefined ? [] : [page];
      }),
    ),
  ];
  const rosterWasDenied = useRef(false);
  useEffect(() => {
    if (denied && !rosterWasDenied.current) {
      const key = queryKeys.comments(
        context.identity,
        context.boardId,
        context.cardId,
      );
      data.cancelResourceRequests(key);
      data.evict(context.identity, [key]);
      setDraft((value) => ({ ...value, spans: [] }));
      setEditing((value) =>
        value ? { ...value, draft: { ...value.draft, spans: [] } } : undefined,
      );
    }
    rosterWasDenied.current = denied;
  }, [denied, data, context.identity, context.boardId, context.cardId]);
  useEffect(() => {
    if (!explicit) {
      setDraft(emptyDraft());
      setEditing(undefined);
      setDeleting(undefined);
    }
  }, [explicit]);
  useEffect(() => {
    if (pageData && page > Math.max(1, pageData.meta.totalPages))
      setPage(Math.max(1, pageData.meta.totalPages));
  }, [page, pageData]);
  const clear = () => {
    setDraft(emptyDraft());
    setEditing(undefined);
  };
  const dirty =
    !!draft.text ||
    (!!editing &&
      (editing.draft.text !== editing.original.content ||
        JSON.stringify(editing.draft.spans) !==
          JSON.stringify(editing.original.mentions)));
  const leave = useCommentLeave(
    dirty,
    busy,
    context.active,
    `/boards/${context.boardId}/cards/${context.cardId}`,
    clear,
  );
  async function submit(kind: 'create' | 'edit' | 'delete') {
    if (
      busy ||
      !writable ||
      !online ||
      !writeRetry ||
      (kind === 'create' && uncertain) ||
      (kind === 'edit' && conflicted)
    )
      return;
    const original = kind === 'edit' ? editing?.original : deleting;
    if (kind !== 'create' && !original) return;
    setError(undefined);
    setNotice('');
    try {
      const result = await mutation.run(
        kind === 'create'
          ? { kind, draft, rosterPages: mentionPages(draft) }
          : kind === 'edit' && editing
            ? {
                kind,
                original: editing.original,
                draft: editing.draft,
                page: editing.page,
                rosterPages: mentionPages(editing.draft),
              }
            : { kind: 'delete', original: original!, page },
      );
      if (!result) return;
      if (kind === 'create') {
        setDraft(emptyDraft());
        setUncertain(false);
        setReviewed(false);
      }
      if (kind === 'edit') setEditing(undefined);
      if (kind === 'delete') setDeleting(undefined);
      setNotice(
        kind === 'create'
          ? 'Comment posted.'
          : kind === 'edit'
            ? 'Comment saved.'
            : 'Comment deleted.',
      );
    } catch (cause) {
      setError(cause);
      setErrorAt(Date.now());
      if (kind === 'create' && uncertainCommentWrite(cause)) {
        setUncertain(true);
        setReviewed(false);
      }
      if (
        kind === 'edit' &&
        (uncertainCommentWrite(cause) ||
          (cause instanceof ApiError && cause.status === 409))
      )
        setConflicted(true);
    }
  }
  async function review() {
    const result = await comments.refetch();
    if (result.isError || !result.data) return;
    setReviewed(true);
    if (editing) {
      try {
        const latest = await createCommentsApi(
          data.api,
          context.identity,
          context.boardId,
          context.cardId,
        ).list(editing.page, new AbortController().signal);
        data.assertCurrent(context.identity);
        const actual = latest.data.find(
          (row) => row.id === editing.original.id,
        );
        if (!actual) {
          setNotice(
            'This comment is no longer on its original page. Cancel editing and locate it again.',
          );
          return;
        }
        setEditing((value) => (value ? { ...value, original: actual } : value));
        setConflicted(false);
        setNotice(
          `Latest saved version: ${actual.content}\nYour draft is retained. Review before saving.`,
        );
      } catch (cause) {
        setError(cause);
        setErrorAt(Date.now());
      }
    }
  }
  const composer = (
    value: MentionDraft,
    onChange: (value: MentionDraft) => void,
    label: string,
  ) => (
    <MentionComposer
      label={label}
      draft={value}
      onChange={onChange}
      candidates={available ? candidates : []}
      disabled={busy || !eligible}
      membersLoading={rosterBusy}
      memberError={
        !explicit || denied
          ? 'Board member suggestions are unavailable.'
          : rosterError
            ? workspaceErrorMessage(rosterError.error)
            : undefined
      }
      retryMembers={
        rosterError && !denied && rosterRetry
          ? () => {
              void rosterError.refetch();
            }
          : undefined
      }
      moreMembers={available && state.hasMoreMembers}
      loadMembers={state.loadMembers}
    />
  );
  return (
    <View testID="card-comments" style={{ gap: spacing.md }}>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[typography.strong, { color: c.text }]}
        >
          Comments
        </Text>
        {pageData && (
          <Text
            style={[
              typography.supporting,
              { color: c.primaryPressed, fontVariant: ['tabular-nums'] },
            ]}
          >
            {pageData.meta.total} comments
          </Text>
        )}
      </View>
      {!online && (
        <Note>You’re offline. Drafts stay here until you reconnect.</Note>
      )}
      {comments.isPending && online && (
        <Skeleton label="Loading comments" height={80} />
      )}
      {comments.isError && (
        <View style={{ gap: spacing.sm }}>
          <Note error>{workspaceErrorMessage(comments.error)}</Note>
          <Button
            label="Retry comments"
            variant="link"
            disabled={!online || !retryReady || comments.isFetching}
            onPress={() => {
              void comments.refetch();
            }}
          />
        </View>
      )}
      {pageData && (
        <Surface>
          {!rows.length && (
            <Note>
              {pageData.meta.total === 0
                ? 'No comments yet.'
                : 'No comments on this page. Refresh to check the conversation.'}
            </Note>
          )}
          {rows.map((comment) => {
            const member = byId.get(comment.authorId)?.member;
            const name = comment.author?.isDeleted
              ? 'Deleted user'
              : (member?.user.displayName ?? 'Unknown author');
            const own =
              writable && comment.authorId === context.identity.userId;
            return (
              <View
                key={comment.id}
                testID={`comment-${comment.id}`}
                style={styles.comment}
              >
                <View style={styles.attribution}>
                  {member && !comment.author ? (
                    <BoardMemberAvatar
                      member={member}
                      identity={context.identity}
                      boardId={context.boardId}
                    />
                  ) : (
                    <Avatar name={name} />
                  )}
                  <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
                    <Text style={[typography.strong, { color: c.text }]}>
                      {name}
                    </Text>
                    <Text
                      style={[typography.caption, { color: c.textSecondary }]}
                    >
                      {new Date(comment.createdAt).toLocaleString()}
                      {Date.parse(comment.updatedAt) >
                      Date.parse(comment.createdAt)
                        ? ' · Edited'
                        : ''}
                    </Text>
                  </View>
                </View>
                <View style={[styles.body, { backgroundColor: c.surfaceSoft }]}>
                  <MentionText
                    comment={comment}
                    allowed={explicit && available}
                  />
                </View>
                {own && !editing && (
                  <View style={composerStyles.actions}>
                    <Button
                      label="Edit"
                      accessibilityLabel={`Edit comment by ${name}`}
                      variant="link"
                      disabled={busy}
                      onPress={() => {
                        setEditing({
                          original: comment,
                          draft: {
                            text: comment.content,
                            spans: available ? comment.mentions : [],
                          },
                          page,
                        });
                        setError(undefined);
                        setConflicted(false);
                      }}
                    />
                    <Button
                      label="Delete"
                      accessibilityLabel={`Delete comment by ${name}`}
                      variant="link"
                      disabled={busy}
                      onPress={() => setDeleting(comment)}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </Surface>
      )}
      {pageData && (
        <View style={composerStyles.actions}>
          <Button
            label="Previous comments"
            variant="link"
            disabled={page <= 1 || busy || comments.isFetching}
            onPress={() => setPage((value) => value - 1)}
          />
          <Text
            style={[
              typography.supporting,
              { color: c.textSecondary, alignSelf: 'center' },
            ]}
          >
            Page {page} of {Math.max(1, pageData.meta.totalPages)}
          </Text>
          <Button
            label="Next comments"
            variant="link"
            disabled={
              page >= pageData.meta.totalPages || busy || comments.isFetching
            }
            onPress={() => setPage((value) => value + 1)}
          />
        </View>
      )}
      {error !== undefined && (
        <Note error>
          {uncertain
            ? 'The send result is uncertain. Your draft is retained. Review the conversation before deciding to send a new comment.'
            : workspaceErrorMessage(error)}
        </Note>
      )}
      {!!notice && <Note>{notice}</Note>}
      {conflicted && (
        <Note error>
          The saved comment may have changed. Review the latest version or
          cancel editing; your draft is retained.
        </Note>
      )}
      {(uncertain || conflicted) && (
        <Button
          label="Review latest comments"
          variant="secondary"
          disabled={!online || comments.isFetching || busy || !retryReady}
          onPress={() => {
            void review();
          }}
        />
      )}
      {uncertain && reviewed && (
        <Button
          label="Allow a new send"
          variant="secondary"
          onPress={() => setConfirmNew(true)}
        />
      )}
      {editing && (
        <View style={{ gap: spacing.sm }}>
          {composer(
            editing.draft,
            (value) =>
              setEditing((old) => (old ? { ...old, draft: value } : old)),
            'Edit comment',
          )}
          <View style={composerStyles.actions}>
            {writable && (
              <Button
                label="Save comment"
                loading={busy}
                disabled={
                  !online ||
                  !writeRetry ||
                  conflicted ||
                  !!contentError(editing.draft.text)
                }
                onPress={() => {
                  void submit('edit');
                }}
              />
            )}
            <Button
              label="Cancel editing"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setEditing(undefined);
                setConflicted(false);
                setError(undefined);
              }}
            />
          </View>
        </View>
      )}
      {!editing && explicit && (eligible || !!draft.text) && (
        <View style={{ gap: spacing.sm }}>
          {composer(draft, setDraft, 'New comment')}
          {writable && (
            <Button
              label="Send comment"
              loading={busy}
              disabled={
                !online ||
                !writeRetry ||
                uncertain ||
                !!contentError(draft.text)
              }
              onPress={() => {
                void submit('create');
              }}
            />
          )}
        </View>
      )}
      {!writable && (
        <Note>
          {denied
            ? 'Board membership must be checked before changing comments.'
            : 'Comments are read-only.'}
        </Note>
      )}
      {denied && (
        <Button
          label="Recheck Board membership"
          variant="secondary"
          disabled={!online || rosterBusy || busy || !rosterRetry}
          onPress={() => {
            void state.recheckMembers().catch((cause: unknown) => {
              setError(cause);
              setErrorAt(Date.now());
            });
          }}
        />
      )}
      <ConfirmDialog
        visible={!!deleting && writable}
        title="Delete comment?"
        message="This comment will be removed from the conversation."
        confirmLabel="Delete comment"
        destructive
        loading={busy}
        confirmDisabled={!online || !writeRetry}
        onConfirm={() => {
          void submit('delete');
        }}
        onCancel={() => {
          if (!busy) setDeleting(undefined);
        }}
      />
      <ConfirmDialog
        visible={confirmNew}
        title="Send as a new comment?"
        message="The earlier send may have succeeded. Sending again can create a duplicate. Check all conversation pages first."
        confirmLabel="Allow new comment"
        onConfirm={() => {
          setUncertain(false);
          setConfirmNew(false);
          setError(undefined);
        }}
        onCancel={() => setConfirmNew(false)}
      />
      <UnsavedChangesPrompt
        visible={leave.visible}
        onKeepEditing={leave.keep}
        onDiscard={leave.discard}
        message="Your unsent comment changes will be lost."
      />
    </View>
  );
}
const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  comment: { gap: spacing.sm, marginBottom: spacing.md },
  attribution: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  body: { padding: spacing.md, borderRadius: radius.control },
});
