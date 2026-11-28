import { queryOptions } from '@tanstack/react-query';
import type { ApiPaginatedResponse } from '@kanban/shared';
import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { kanbanCollection } from '../boards/kanban-model.ts';
import {
  createKanbanApi,
  normalizeKanbanFilters,
  type KanbanCard,
  type KanbanFilters,
} from '../boards/kanban-api.ts';
import { intersectDueRange, type DueInterval } from './interval.ts';

export function calendarFilters(filters: KanbanFilters): KanbanFilters {
  // Calendar is always active; ordering within a day is independent of Board sort.
  return {
    ...filters,
    status: 'active',
    dueStatus:
      filters.dueStatus === 'NO_DUE_DATE' ? undefined : filters.dueStatus,
    sortBy: undefined,
    sortDirection: undefined,
  };
}

export class IncompleteCalendarError extends ApiError {
  constructor() {
    super('invalid-response', {
      code: 'CALENDAR_INCOMPLETE',
      message:
        'Cards changed while loading. Refresh to load a complete calendar.',
    });
  }
}

type CardPage = Pick<ApiPaginatedResponse<KanbanCard>, 'data' | 'meta'>;

/** Sequential OFFSET walk, one bounded restart for detectable drift, no Card cap.
 * REST has no snapshot revision: same-total changes outside the verified first page
 * cannot be proven absent. Realtime/focus refresh reconciles that server limitation.
 */
export async function loadCalendarCards(
  read: (page: number, signal: AbortSignal) => Promise<CardPage>,
  signal: AbortSignal,
): Promise<KanbanCard[]> {
  const check = () => {
    if (signal.aborted) throw new ApiError('aborted');
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const pages: CardPage[] = [];
    let drift = false;
    for (let number = 1; ; number++) {
      check();
      const page = await read(number, signal);
      check();
      const { meta } = page;
      if (
        meta.page !== number ||
        !Number.isSafeInteger(meta.limit) ||
        meta.limit < 1 ||
        meta.limit > 100 ||
        !Number.isSafeInteger(meta.total) ||
        meta.total < 0 ||
        meta.totalPages !== Math.ceil(meta.total / meta.limit)
      )
        throw invalidResponse(200);
      pages.push(page);
      const first = pages[0]!;
      const expected = Math.min(
        meta.limit,
        Math.max(0, meta.total - (number - 1) * meta.limit),
      );
      if (
        meta.total !== first.meta.total ||
        meta.limit !== first.meta.limit ||
        page.data.length !== expected
      ) {
        drift = true;
        break;
      }
      if (number >= meta.totalPages) break;
    }
    const collection = kanbanCollection(pages);
    if (!drift && collection.complete && pages.length > 1) {
      check();
      const verified = await read(1, signal);
      check();
      const first = pages[0]!;
      drift =
        JSON.stringify(verified.meta) !== JSON.stringify(first.meta) ||
        JSON.stringify(verified.data) !== JSON.stringify(first.data);
    }
    if (!drift && collection.complete) return collection.items;
  }
  throw new IncompleteCalendarError();
}

export function calendarCardOptions(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
  filters: KanbanFilters,
  interval?: DueInterval,
) {
  const active = calendarFilters(filters);
  // Only Cards due inside the visible grid can be shown (P02): undated and
  // out-of-window Cards are never downloaded. An empty overlap needs no request.
  const ranged = interval ? intersectDueRange(active, interval) : active;
  const params = normalizeKanbanFilters(ranged ?? active);
  const board = createKanbanApi(api, identity, boardId);
  return queryOptions({
    // Keep the existing Board Card prefix for every mutation/socket/access eviction.
    // Suffix avoids mixing an array with MOB-15's InfiniteData cache shape.
    queryKey: [
      ...queryKeys.cards(identity, boardId, params),
      'complete-calendar',
      interval ? [interval.dueFrom, interval.dueTo] : 'unbounded',
    ] as const,
    queryFn: ({ signal }) =>
      ranged
        ? loadCalendarCards(
            (page, signal) => board.cards(params, page, signal),
            signal,
          )
        : Promise.resolve([] as KanbanCard[]),
    staleTime: 0,
    retry: false,
    gcTime: 0,
  });
}
