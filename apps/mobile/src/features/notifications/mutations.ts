import type { InfiniteData } from '@tanstack/react-query';
import type { NotificationResponse } from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { canRetryWorkspace } from '../workspaces/status.ts';
import { createInboxApi, type InboxFilter, type InboxPage } from './api.ts';
import { inboxOptions, unreadOptions } from './queries.ts';

export function applyReadResponse(
  previous: NotificationResponse,
  response: NotificationResponse,
): NotificationResponse {
  if (previous.id !== response.id) return previous;
  const readAt = previous.readAt ?? response.readAt;
  if (response.isUnavailable)
    return {
      ...previous,
      readAt,
      isUnavailable: true,
      summary: response.summary,
      actor: null,
      context: null,
      target: null,
    };
  // A delayed read ACK conveys read state, never a new grant to actor/context/target.
  return { ...previous, readAt };
}
type State = {
  pending: string | null;
  mustReview: boolean;
  error: unknown;
  errorUpdatedAt: number;
};
function createCommands(data: MobileDataLayer, identity: SessionIdentity) {
  const api = createInboxApi(data.api, identity),
    root = queryKeys.notifications(identity);
  const listeners = new Set<() => void>();
  let state: State = {
    pending: null,
    mustReview: false,
    error: null,
    errorUpdatedAt: 0,
  };
  function publish(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  function guard(review = false) {
    data.assertCurrent(identity);
    if (state.pending || (state.mustReview && !review))
      throw new ApiError('http', {
        status: 409,
        code: 'INBOX_REVIEW_REQUIRED',
      });
    if (!canRetryWorkspace(state.error, state.errorUpdatedAt))
      throw new ApiError('http', { status: 429 });
  }
  function fence() {
    data.cancelResourceRequests(root);
    void data.queryClient.cancelQueries({ queryKey: root });
    data.resources.bumpKey(root);
  }
  function reconcile() {
    data.evict(identity, [root]);
    void data.queryClient
      .invalidateQueries({ queryKey: root }, { cancelRefetch: false })
      .catch(() => undefined);
  }
  async function execute<T>(
    pending: string,
    request: (signal: AbortSignal) => Promise<T>,
    apply?: (result: T) => void,
  ): Promise<T> {
    guard();
    publish({ pending, error: null });
    fence();
    const current = data.resources.capture(root, false);
    const controller = new AbortController();
    try {
      const result = await request(controller.signal);
      data.assertCurrent(identity);
      current();
      apply?.(result);
      return result;
    } catch (error) {
      if (sameIdentity(identity, data.getIdentity())) {
        const ambiguous =
          !(error instanceof ApiError) ||
          (error.requestStarted !== false &&
            (error.status >= 500 ||
              [
                'timeout',
                'network',
                'invalid-response',
                'aborted',
                'session-changed',
              ].includes(error.kind)));
        publish({ error, errorUpdatedAt: Date.now(), mustReview: ambiguous });
      }
      throw error;
    } finally {
      if (sameIdentity(identity, data.getIdentity())) reconcile();
      publish({ pending: null });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read(id: string) {
      return execute(
        id,
        (signal) => api.read(id, signal),
        (response) => {
          for (const query of data.queryClient
            .getQueryCache()
            .findAll({ queryKey: [...root, 'list'] }))
            data.queryClient.setQueryData<InfiniteData<InboxPage, number>>(
              query.queryKey,
              (previous) =>
                previous
                  ? {
                      ...previous,
                      pages: previous.pages.map((page) => ({
                        ...page,
                        data: page.data.map((row) =>
                          applyReadResponse(row, response),
                        ),
                      })),
                    }
                  : previous,
            );
        },
      );
    },
    readAll() {
      return execute('all', (signal) => api.readAll(signal));
    },
    async review(filter: InboxFilter) {
      guard(true);
      publish({ pending: 'review' });
      data.evict(identity, [root]);
      const current = data.resources.capture(root, false);
      try {
        const [list, unread] = await Promise.all([
          data.queryClient.fetchInfiniteQuery(
            inboxOptions(data, identity, filter),
          ),
          data.queryClient.fetchQuery(unreadOptions(data, identity)),
        ]);
        data.assertCurrent(identity);
        current();
        if (!list?.pages.length || typeof unread !== 'number')
          throw new ApiError('session-changed');
        publish({ mustReview: false, error: null });
      } catch (error) {
        if (sameIdentity(identity, data.getIdentity()))
          publish({ mustReview: true, error, errorUpdatedAt: Date.now() });
        throw error;
      } finally {
        publish({ pending: null });
      }
    },
  };
}
const stores = new WeakMap<
  MobileDataLayer,
  { identity: SessionIdentity; commands: ReturnType<typeof createCommands> }
>();
export function inboxCommands(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  const previous = stores.get(data);
  if (previous && sameIdentity(previous.identity, identity))
    return previous.commands;
  const commands = createCommands(data, identity);
  stores.set(data, { identity, commands });
  return commands;
}
