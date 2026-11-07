import { useId, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { isCardDateInstant, type BoardCardFilters } from '@kanban/shared';
import { CloseIcon, SlidersIcon } from '../../components/icons';
import { Dialog } from '../../components/Dialog';
import { retryUnlessClientError } from '../../lib/query-client';
import { fetchAllPages, isApiError } from '../../lib/api-client';
import { useAuth } from '../auth/useAuth';
import { useAuthSession } from '../auth/auth-session-context';
import type { BoardMember } from '../board-members/types';
import type { Label } from '../labels/api';
import { boardKeys } from '../boards/query-keys';
import { listFilteredCards, listPreviewSummaries } from './api';

const keys = [
  'q',
  'labelIds',
  'assigneeIds',
  'dueStatus',
  'dueFrom',
  'dueTo',
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = ['NO_DUE_DATE', 'OVERDUE', 'DUE_TODAY', 'UPCOMING'] as const;
export function parseBoardFilters(params: URLSearchParams): BoardCardFilters {
  const result: BoardCardFilters = {};
  const q = params.get('q')?.trim().slice(0, 200);
  if (q) result.q = q;
  for (const key of ['labelIds', 'assigneeIds'] as const) {
    const ids = [
      ...new Set(
        (params.get(key) ?? '')
          .split(',')
          .filter((id) => uuid.test(id))
          .map((id) => id.toLowerCase()),
      ),
    ]
      .sort()
      .slice(0, 50);
    if (ids.length) result[key] = ids;
  }
  const status = params.get('dueStatus');
  if (statuses.some((value) => value === status))
    result.dueStatus = status as BoardCardFilters['dueStatus'];
  for (const key of ['dueFrom', 'dueTo'] as const) {
    const value = params.get(key);
    if (value && isCardDateInstant(value))
      result[key] = new Date(value).toISOString();
  }
  if (result.dueFrom && result.dueTo && result.dueFrom >= result.dueTo) {
    delete result.dueFrom;
    delete result.dueTo;
  }
  return result;
}
/** Only documented filter fields are eligible for a shared Board link. */
export function filterSearchParams(filters: BoardCardFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = filters[key];
    if (value && (!Array.isArray(value) || value.length))
      params.set(
        key,
        Array.isArray(value) ? [...value].sort().join(',') : value,
      );
  }
  return params;
}
export function useBoardFilters() {
  const [params, setParams] = useSearchParams();
  const filters = parseBoardFilters(params);
  const apply = (next: BoardCardFilters) => {
    const updated = new URLSearchParams(params);
    keys.forEach((key) => updated.delete(key));
    filterSearchParams(next).forEach((value, key) => updated.set(key, value));
    setParams(updated);
  };
  return { filters, apply, active: Object.keys(filters).length > 0 };
}
export function useFilteredCards(
  boardId: string,
  filters: BoardCardFilters,
  page: number,
  enabled: boolean,
) {
  const { runAuthorized, user } = useAuth();
  const { generation } = useAuthSession();
  return useQuery({
    queryKey: [
      ...boardKeys.cards(boardId),
      'filtered',
      user?.id,
      generation,
      filters,
      page,
    ],
    queryFn: ({ signal }) =>
      runAuthorized((token) =>
        listFilteredCards(token, boardId, filters, page, signal),
      ),
    retry: retryUnlessClientError,
    enabled,
  });
}

/** All matching active cards, using the same server-side filter contract. */
export function useAllFilteredCards(
  boardId: string,
  filters: BoardCardFilters,
  enabled: boolean,
) {
  const { runAuthorized, user } = useAuth();
  const { generation } = useAuthSession();
  return useQuery({
    queryKey: [
      ...boardKeys.cards(boardId),
      'filtered',
      user?.id,
      generation,
      filters,
      'all',
    ],
    queryFn: ({ signal }) =>
      runAuthorized((token) =>
        fetchAllPages((page) =>
          listFilteredCards(token, boardId, filters, page, signal),
        ),
      ),
    retry: retryUnlessClientError,
    enabled,
  });
}
export function usePreviewSummaries(boardId: string, ids: string[]) {
  const { runAuthorized, user } = useAuth();
  const { generation } = useAuthSession();
  const sorted = [...ids].sort();
  // Preserve the old one-request-at-a-time behavior for large Boards.
  const serial = useMemo(() => {
    let tail: Promise<unknown> = Promise.resolve();
    return <T,>(task: () => Promise<T>, signal: AbortSignal) => {
      const result = tail.then(() => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return task();
      });
      tail = result.catch(() => undefined);
      return result;
    };
  }, [boardId, user?.id, generation]);
  const chunks: string[][] = [];
  for (let i = 0; i < sorted.length; i += 100)
    chunks.push(sorted.slice(i, i + 100));
  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: [
        ...boardKeys.cards(boardId),
        'preview-summaries',
        user?.id,
        generation,
        chunk,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        serial(
          () =>
            runAuthorized(
              async (token) =>
                (await listPreviewSummaries(token, boardId, chunk, signal))
                  .summaries,
            ),
          signal,
        ),
      enabled: !!user,
      retry: retryUnlessClientError,
    })),
  });
  const denied = queries.find(
    (query) =>
      isApiError(query.error) && [401, 403, 404].includes(query.error.status),
  )?.error;
  const error = denied ?? queries.find((query) => query.isError)?.error;
  const complete =
    chunks.length > 0 && queries.every((query) => query.data !== undefined);
  return {
    data:
      !denied && complete
        ? queries.flatMap((query) => query.data ?? [])
        : undefined,
    error,
    isError: queries.some((query) => query.isError),
    isSuccess: chunks.length > 0 && queries.every((query) => query.isSuccess),
    isFetching: queries.some((query) => query.isFetching),
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
  };
}

export function BoardFilter({
  filters,
  apply,
  labels,
  members,
  labelsPending,
  labelsError,
  membersPending,
  membersError,
  retryLabels,
  retryMembers,
  clearLabel = 'Clear filters',
  compact = false,
}: {
  filters: BoardCardFilters;
  apply: (filters: BoardCardFilters) => void;
  labels: Label[];
  members: BoardMember[];
  labelsPending: boolean;
  labelsError: boolean;
  membersPending: boolean;
  membersError: boolean;
  retryLabels: () => void;
  retryMembers: () => void;
  clearLabel?: string;
  compact?: boolean;
}) {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BoardCardFilters>(filters);
  const [labelSearch, setLabelSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const toggle = (key: 'labelIds' | 'assigneeIds', id: string) =>
    setDraft((old) => {
      const values = old[key] ?? [];
      return {
        ...old,
        [key]: values.includes(id)
          ? values.filter((item) => item !== id)
          : [...values, id],
      };
    });
  const count = Object.values(filters).filter((value) =>
    Array.isArray(value) ? value.length : !!value,
  ).length;
  const chip = (text: string, next: BoardCardFilters, key?: string) => (
    <span
      key={key}
      className={
        compact
          ? 'inline-flex items-center gap-1 rounded-full bg-app/80 px-3 py-1.5 text-xs text-ink'
          : 'rounded bg-app px-2 py-1 text-xs'
      }
    >
      <span className="min-w-0 break-words">{text}</span>
      {compact && (
        <button
          type="button"
          aria-label={`Remove ${text}`}
          onClick={() => apply(next)}
          className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
        >
          <CloseIcon className="size-3" />
        </button>
      )}
    </span>
  );
  return (
    <div
      role="group"
      aria-label="Board filters"
      className="mb-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line/60 bg-surface/85 p-2 shadow-sm [&>span]:max-w-full [&>span]:[overflow-wrap:anywhere]"
    >
      <button
        type="button"
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-primary"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dialogId : undefined}
        onClick={() => {
          setDraft(filters);
          setOpen(true);
        }}
      >
        <SlidersIcon className="size-4" />
        Filter
        {count > 0 && (
          <span
            className={
              compact
                ? 'grid size-5 place-items-center rounded-full bg-primary-solid text-xs text-white'
                : 'rounded-md bg-primary-soft px-1.5 text-xs text-primary'
            }
          >
            {compact ? count : `(${count})`}
          </span>
        )}
      </button>
      {count === 0 && (
        <span className="border-l border-line pl-3 text-sm text-muted">
          No filters applied
        </span>
      )}
      {filters.q && chip(`Keyword: ${filters.q}`, { ...filters, q: undefined })}
      {filters.labelIds?.map((id) =>
        chip(
          `Label: ${labels.find((item) => item.id === id)?.name ?? 'Unavailable'}`,
          {
            ...filters,
            labelIds: filters.labelIds?.filter((value) => value !== id),
          },
          id,
        ),
      )}
      {filters.assigneeIds?.map((id) =>
        chip(
          `Assignee: ${members.find((item) => item.user.id === id)?.user.displayName ?? 'Unavailable'}`,
          {
            ...filters,
            assigneeIds: filters.assigneeIds?.filter((value) => value !== id),
          },
          id,
        ),
      )}
      {filters.dueStatus &&
        chip(filters.dueStatus.replaceAll('_', ' '), {
          ...filters,
          dueStatus: undefined,
        })}
      {(filters.dueFrom || filters.dueTo) &&
        chip('Due date range (UTC)', {
          ...filters,
          dueFrom: undefined,
          dueTo: undefined,
        })}
      {count > 0 && (
        <button
          type="button"
          className="text-sm text-primary underline"
          onClick={() => apply({})}
        >
          {clearLabel}
        </button>
      )}
      <Dialog
        id={dialogId}
        open={open}
        onClose={() => setOpen(false)}
        title="Filter cards"
      >
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply(
              parseBoardFilters(
                new URLSearchParams(
                  Object.entries(draft)
                    .filter(
                      ([, value]) =>
                        value && (!Array.isArray(value) || value.length),
                    )
                    .map(([key, value]) => [
                      key,
                      Array.isArray(value) ? value.join(',') : String(value),
                    ]),
                ),
              ),
            );
            setOpen(false);
          }}
        >
          <label className="block text-sm font-medium sm:col-span-2">
            Keyword
            <input
              maxLength={200}
              className="mt-1 w-full rounded-lg border border-line bg-surface p-2"
              value={draft.q ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, q: event.target.value })
              }
            />
          </label>
          <details className="rounded-lg border border-line sm:col-span-2">
            <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary">
              <span>Labels</span>
              <span className="ml-2 text-xs font-normal text-muted">
                {draft.labelIds?.length
                  ? `${draft.labelIds.length} selected`
                  : 'Any'}
              </span>
            </summary>
            <div className="border-t border-line p-3">
              <input
                placeholder="Search labels…"
                aria-label="Search labels"
                value={labelSearch}
                onChange={(event) => setLabelSearch(event.target.value)}
                className="my-1 w-full rounded border border-line bg-surface p-2 text-sm"
              />
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                {labelsPending ? (
                  <p role="status">Loading labels...</p>
                ) : labelsError ? (
                  <p role="alert">
                    Could not load labels.{' '}
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={retryLabels}
                    >
                      Retry
                    </button>
                  </p>
                ) : labels.length ? (
                  labels
                    .filter((label) =>
                      label.name
                        .toLowerCase()
                        .includes(labelSearch.toLowerCase()),
                    )
                    .map((label) => (
                      <label
                        className="flex min-h-11 items-center gap-2 py-1 text-sm sm:min-h-9"
                        key={label.id}
                      >
                        <input
                          type="checkbox"
                          disabled={
                            (draft.labelIds?.length ?? 0) >= 50 &&
                            !draft.labelIds?.includes(label.id)
                          }
                          checked={draft.labelIds?.includes(label.id) ?? false}
                          onChange={() => toggle('labelIds', label.id)}
                        />
                        {label.name}
                      </label>
                    ))
                ) : (
                  <p className="text-sm text-muted">No labels available.</p>
                )}
              </div>
            </div>
          </details>
          <details className="rounded-lg border border-line sm:col-span-2">
            <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary">
              <span>Assignees</span>
              <span className="ml-2 text-xs font-normal text-muted">
                {draft.assigneeIds?.length
                  ? `${draft.assigneeIds.length} selected`
                  : 'Any'}
              </span>
            </summary>
            <div className="border-t border-line p-3">
              <input
                placeholder="Search assignees…"
                aria-label="Search assignees"
                value={memberSearch}
                onChange={(event) => setMemberSearch(event.target.value)}
                className="my-1 w-full rounded border border-line bg-surface p-2 text-sm"
              />
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                {membersPending ? (
                  <p role="status">Loading assignees...</p>
                ) : membersError ? (
                  <p role="alert">
                    Could not load assignees.{' '}
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={retryMembers}
                    >
                      Retry
                    </button>
                  </p>
                ) : members.length ? (
                  members
                    .filter((member) =>
                      member.user.displayName
                        .toLowerCase()
                        .includes(memberSearch.toLowerCase()),
                    )
                    .map((member) => (
                      <label
                        className="flex min-h-11 items-center gap-2 py-1 text-sm sm:min-h-9"
                        key={member.user.id}
                      >
                        <input
                          type="checkbox"
                          disabled={
                            (draft.assigneeIds?.length ?? 0) >= 50 &&
                            !draft.assigneeIds?.includes(member.user.id)
                          }
                          checked={
                            draft.assigneeIds?.includes(member.user.id) ?? false
                          }
                          onChange={() => toggle('assigneeIds', member.user.id)}
                        />
                        {member.user.displayName}
                      </label>
                    ))
                ) : (
                  <p className="text-sm text-muted">No assignees available.</p>
                )}
              </div>
            </div>
          </details>
          <label className="block text-sm font-medium sm:col-span-2">
            Due status
            <select
              className="mt-1 w-full rounded-lg border border-line bg-surface p-2"
              value={draft.dueStatus ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  dueStatus: (event.target.value ||
                    undefined) as BoardCardFilters['dueStatus'],
                })
              }
            >
              <option value="">Any</option>
              <option value="NO_DUE_DATE">No due date</option>
              <option value="OVERDUE">Overdue</option>
              <option value="DUE_TODAY">Due today</option>
              <option value="UPCOMING">Upcoming</option>
            </select>
          </label>
          {(['dueFrom', 'dueTo'] as const).map((key) => (
            <label key={key} className="block text-sm font-medium">
              {key === 'dueFrom'
                ? 'Due from (UTC, inclusive)'
                : 'Due before (UTC, exclusive)'}
              <input
                type="datetime-local"
                step="0.001"
                className="mt-1 w-full rounded-lg border border-line bg-surface p-2"
                value={draft[key]?.replace(/Z$/, '') ?? ''}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    [key]: event.target.value
                      ? `${event.target.value}Z`
                      : undefined,
                  })
                }
              />
            </label>
          ))}
          {draft.dueFrom && draft.dueTo && draft.dueFrom >= draft.dueTo && (
            <p role="alert" className="text-sm text-danger">
              The end must be after the start.
            </p>
          )}
          <div className="sticky -bottom-5 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-surface px-1 py-3 sm:-bottom-6 sm:col-span-2">
            <button
              type="submit"
              disabled={
                !!draft.dueFrom && !!draft.dueTo && draft.dueFrom >= draft.dueTo
              }
              className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-line px-4 py-2 text-sm"
              onClick={() => setDraft({})}
            >
              Reset
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-line px-4 py-2 text-sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
