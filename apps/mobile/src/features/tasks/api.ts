import {
  TaskGroup,
  isCardDateInstant,
  type MyTasksFilters,
} from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type {
  SessionIdentity,
  SessionHttpClient,
} from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { decodeFullMyTasksEnvelope, validateTaskPage } from './decoder.ts';

const v4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type TaskFilters = Omit<
  MyTasksFilters,
  'page' | 'limit' | 'labelIds'
> & { labelIds?: readonly string[] };
export function normalizeTaskFilters(input: TaskFilters = {}) {
  const group = input.group ?? 'ALL';
  const sort = input.sort ?? 'dueDate';
  const labels = input.labelIds ?? [];
  if (
    !['ALL', ...Object.values(TaskGroup)].includes(group) ||
    !['dueDate', 'updatedAt', 'board'].includes(sort) ||
    [input.workspaceId, input.boardId].some(
      (id) => id !== undefined && !v4.test(id),
    ) ||
    labels.length > 50 ||
    new Set(labels.map((id) => id.toLowerCase())).size !== labels.length ||
    labels.some((id) => !v4.test(id)) ||
    (labels.length > 0 && !input.boardId) ||
    [input.dueFrom, input.dueTo].some(
      (date) => date !== undefined && !isCardDateInstant(date),
    ) ||
    (input.dueFrom &&
      input.dueTo &&
      Date.parse(input.dueFrom) >= Date.parse(input.dueTo))
  )
    throw new ApiError('configuration', {
      message: 'Check the task filters and date range.',
    });
  return {
    group,
    sort,
    workspaceId: input.workspaceId?.toLowerCase(),
    boardId: input.boardId?.toLowerCase(),
    labelIds: labels.length
      ? [...labels]
          .map((id) => id.toLowerCase())
          .sort()
          .join(',')
      : undefined,
    dueFrom: input.dueFrom,
    dueTo: input.dueTo,
  };
}
export function createTasksApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  return {
    async list(input: TaskFilters, page: number, signal: AbortSignal) {
      if (!Number.isSafeInteger(page) || page < 1)
        throw new ApiError('configuration');
      const filters = normalizeTaskFilters(input);
      const key = [...queryKeys.tasks(identity), filters] as const;
      const result = await api.rawJson(
        '/users/me/tasks',
        decodeFullMyTasksEnvelope,
        {
          identity,
          resourceKey: key,
          signal,
          expectedStatus: 200,
          retries: 0,
          query: { ...filters, page, limit: 20 },
        },
      );
      return validateTaskPage(result, filters, page);
    },
  };
}
