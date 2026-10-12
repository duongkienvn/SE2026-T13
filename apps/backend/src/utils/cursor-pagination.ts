import { BadRequestException } from '@nestjs/common';
import { ObjectLiteral, SelectQueryBuilder, Brackets } from 'typeorm';
import { CursorResult, cursorResult } from '../common/dto/cursor-result';

interface CursorValue {
  v: 1;
  timestamp: string;
  id: string;
}

export interface CursorPageQuery {
  limit: number;
  cursor?: string;
}

const UTC_MICROSECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validTimestamp(value: string): boolean {
  if (!UTC_MICROSECOND.test(value)) return false;
  const parsed = Date.parse(value);
  return (
    !Number.isNaN(parsed) &&
    new Date(parsed).toISOString() === `${value.slice(0, 23)}Z`
  );
}

function decodeCursor(cursor: string): CursorValue {
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new BadRequestException('Invalid cursor');
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.toString('base64url') !== cursor)
      throw new Error('Non-canonical cursor');
    const value: unknown = JSON.parse(decoded.toString('utf8'));
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as CursorValue).v !== 1 ||
      typeof (value as CursorValue).timestamp !== 'string' ||
      !validTimestamp((value as CursorValue).timestamp) ||
      typeof (value as CursorValue).id !== 'string' ||
      !UUID.test((value as CursorValue).id)
    )
      throw new Error('Invalid cursor content');
    return value as CursorValue;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

function encodeCursor(timestamp: string, id: string): string {
  return Buffer.from(
    JSON.stringify({ v: 1, timestamp, id } satisfies CursorValue),
  ).toString('base64url');
}

/** Forward-only cursor pagination for a timestamp column plus a UUID primary key. */
export async function paginateCursor<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  query: CursorPageQuery,
  timestampField: Extract<keyof T, string>,
  direction: 'ASC' | 'DESC' = 'DESC',
): Promise<CursorResult<T>> {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100
  ) {
    throw new BadRequestException('Cursor limit must be between 1 and 100');
  }
  if (builder.expressionMap.joinAttributes.length > 0) {
    throw new TypeError('Cursor pagination requires an unjoined entity query');
  }
  if (
    builder.expressionMap.skip != null ||
    builder.expressionMap.take != null ||
    builder.expressionMap.offset != null ||
    builder.expressionMap.limit != null
  ) {
    throw new TypeError(
      'Cursor pagination requires a query without existing pagination',
    );
  }
  const alias = builder.expressionMap.mainAlias;
  const metadata = alias?.metadata;
  const timestamp = metadata?.findColumnWithPropertyPath(timestampField);
  const primary = metadata?.primaryColumns[0];
  if (
    !alias ||
    !timestamp ||
    timestamp.isNullable ||
    !primary ||
    metadata.primaryColumns.length !== 1 ||
    !['timestamp with time zone', 'timestamptz'].includes(
      String(timestamp.type),
    ) ||
    primary.type !== 'uuid'
  )
    throw new TypeError(
      'Cursor pagination requires a timestamptz field and UUID primary key',
    );

  const queryBuilder = builder.clone();
  const timeColumn = `${queryBuilder.escape(alias.name)}.${queryBuilder.escape(timestamp.databaseName)}`;
  const idColumn = `${queryBuilder.escape(alias.name)}.${queryBuilder.escape(primary.databaseName)}`;
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    const operator = direction === 'DESC' ? '<' : '>';
    queryBuilder.andWhere(
      new Brackets((where) => {
        where
          .where(`${timeColumn} ${operator} :cursorTime`, {
            cursorTime: cursor.timestamp,
          })
          .orWhere(
            `${timeColumn} = :cursorTime AND ${idColumn} ${operator} :cursorId`,
            {
              cursorTime: cursor.timestamp,
              cursorId: cursor.id,
            },
          );
      }),
    );
  }
  queryBuilder
    .addSelect(
      `to_char(${timeColumn} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z'`,
      '__cursor_timestamp',
    )
    .orderBy(`${alias.name}.${timestamp.propertyPath}`, direction)
    .addOrderBy(`${alias.name}.${primary.propertyPath}`, direction)
    .take(query.limit + 1);
  const { entities, raw } = await queryBuilder.getRawAndEntities();
  if (entities.length !== raw.length) {
    throw new TypeError('Cursor pagination requires one raw row per entity');
  }
  const hasMore = entities.length > query.limit;
  const data = hasMore ? entities.slice(0, query.limit) : entities;
  const lastIndex = data.length - 1;
  const timestampText: unknown = raw[lastIndex]?.__cursor_timestamp;
  const id: unknown = data[lastIndex]?.[primary.propertyName];
  const nextCursor =
    hasMore && typeof timestampText === 'string' && typeof id === 'string'
      ? encodeCursor(timestampText, id)
      : null;
  if (hasMore && nextCursor === null)
    throw new TypeError('Cursor values are missing');
  return cursorResult(data, query.limit, nextCursor);
}
