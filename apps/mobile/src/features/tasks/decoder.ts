import {
  TaskGroup,
  type MyTasksResponse,
  type MyTasksFilters,
} from '@kanban/shared';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import { decodeTask } from '../home/decoder.ts';

export const taskGroups = Object.values(TaskGroup);
const v4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(200);
  return value as Record<string, unknown>;
}
function count(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidResponse(200);
  return value;
}

/** Preserve and validate the complete wire response, including top-level counts. */
export function decodeFullMyTasksEnvelope(value: unknown): MyTasksResponse {
  try {
    const row = record(value);
    const meta = record(row.meta);
    const counts = record(row.groupCounts);
    if (
      row.success !== true ||
      row.statusCode !== 200 ||
      typeof row.message !== 'string' ||
      !Array.isArray(row.data)
    )
      throw invalidResponse(200);
    const page = count(meta.page);
    const limit = count(meta.limit);
    const total = count(meta.total);
    const totalPages = count(meta.totalPages);
    if (
      !page ||
      !limit ||
      limit > 100 ||
      totalPages !== Math.ceil(total / limit) ||
      row.data.length !==
        Math.min(limit, Math.max(0, total - (page - 1) * limit))
    )
      throw invalidResponse(200);
    const data = row.data.map(decodeTask);
    if (
      new Set(data.map(({ id }) => id)).size !== data.length ||
      data.some((task) =>
        [
          task.id,
          task.boardId,
          task.workspaceId,
          task.columnId,
          ...task.labels.map(({ id }) => id),
        ].some((id) => !v4.test(id)),
      )
    )
      throw invalidResponse(200);
    const groupCounts = {
      OVERDUE: count(counts.OVERDUE),
      NEXT_7_DAYS: count(counts.NEXT_7_DAYS),
      LATER: count(counts.LATER),
      NO_DUE_DATE: count(counts.NO_DUE_DATE),
    };
    if (
      !Number.isSafeInteger(
        Object.values(groupCounts).reduce((a, b) => a + b, 0),
      )
    )
      throw invalidResponse(200);
    return {
      success: true,
      statusCode: 200,
      message: row.message,
      data,
      meta: { page, limit, total, totalPages },
      groupCounts,
    };
  } catch {
    throw invalidResponse(200);
  }
}

export function validateTaskPage(
  result: MyTasksResponse,
  filters: MyTasksFilters,
  page: number,
) {
  const group = filters.group ?? 'ALL';
  const total =
    group === 'ALL'
      ? Object.values(result.groupCounts).reduce((a, b) => a + b, 0)
      : result.groupCounts[group];
  if (
    result.meta.page !== page ||
    result.meta.limit !== 20 ||
    result.meta.total !== total ||
    result.data.some(
      (task) =>
        (group !== 'ALL' && task.group !== group) ||
        (filters.workspaceId && task.workspaceId !== filters.workspaceId) ||
        (filters.boardId && task.boardId !== filters.boardId),
    )
  )
    throw invalidResponse(200);
  return result;
}
