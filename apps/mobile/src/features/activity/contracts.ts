import type { ApiPaginatedResponse } from '@kanban/shared';
import type { Decoder, Envelope } from '../../infrastructure/api/client.ts';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import { requirePage } from '../../infrastructure/query/pagination.ts';
import { parseResourceId } from '../../navigation/routes.ts';

export const activityPageSize = 20;

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(200);
  return value as Record<string, unknown>;
}

export function id(value: unknown) {
  if (typeof value !== 'string') throw invalidResponse(200);
  const result = parseResourceId(value);
  if (!result) throw invalidResponse(200);
  return result;
}

export function text(value: unknown, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw invalidResponse(200);
  return value;
}

export function instant(value: unknown) {
  const result = text(value, 30);
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    throw invalidResponse(200);
  return result;
}

export function validatePagination(page: number, limit: number) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger((page - 1) * limit)
  )
    throw invalidResponse(200);
}

export function decodeRows<T extends { id: string; createdAt: string }>(
  decode: Decoder<T>,
  limit: number,
) {
  return (value: unknown): T[] => {
    if (!Array.isArray(value) || value.length > limit)
      throw invalidResponse(200);
    const rows = Array.from(value, decode);
    const seen = new Set<string>();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const previous = rows[index - 1];
      if (
        seen.has(row.id) ||
        (previous &&
          (previous.createdAt < row.createdAt ||
            (previous.createdAt === row.createdAt && previous.id < row.id)))
      )
        throw invalidResponse(200);
      seen.add(row.id);
    }
    return rows;
  };
}

export function activityPage<T>(
  envelope: Envelope<T[]>,
  page: number,
  limit: number,
): ApiPaginatedResponse<T> {
  const result = requirePage(envelope);
  const { meta } = result;
  if (
    meta.page !== page ||
    meta.limit !== limit ||
    !Number.isSafeInteger(meta.total) ||
    meta.total < 0 ||
    meta.totalPages !== Math.ceil(meta.total / limit) ||
    result.data.length !==
      Math.min(limit, Math.max(0, meta.total - (page - 1) * limit))
  )
    throw invalidResponse(200);
  return result;
}

export function ownLabel(
  labels: Readonly<Record<string, string>>,
  value: string,
) {
  return Object.hasOwn(labels, value) ? labels[value]! : 'made a change';
}
