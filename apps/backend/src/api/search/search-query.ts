import type { GlobalSearchItem, SearchGroup } from '@kanban/shared';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { searchWindow, type SearchQueryDto } from './dto/search-query.dto';

/** Same literal LIKE escaping as Board discovery and Board-local Card filters. */
export function searchParameters(term: string) {
  const literal = term.replace(/[\\%_]/g, '\\$&');
  return { term, contains: `%${literal}%`, prefix: `${literal}%` };
}

export function titleRank(column: string): string {
  // column is a fixed server-owned expression, never user input.
  return `CASE WHEN LOWER(${column}) = LOWER(:term) THEN 0
    WHEN ${column} ILIKE :prefix ESCAPE '\\' THEN 1
    WHEN ${column} ILIKE :contains ESCAPE '\\' THEN 2 ELSE 3 END`;
}

export async function searchPage<
  Entity extends ObjectLiteral,
  Row,
  Item extends GlobalSearchItem,
>(
  base: SelectQueryBuilder<Entity>,
  input: SearchQueryDto,
  order: { title: string; updatedAt: string; id: string },
  map: (row: Row) => Item,
): Promise<SearchGroup<Item>> {
  const { limit, offset } = searchWindow(input);
  const count = await base
    .clone()
    .select('COUNT(*)', 'total')
    .getRawOne<{ total: string }>();
  const total = Number(count!.total);
  const rows = await base
    .orderBy(titleRank(order.title), 'ASC')
    .addOrderBy(order.updatedAt, 'DESC')
    .addOrderBy(order.id, 'ASC')
    .offset(offset)
    .limit(limit)
    .getRawMany<Row>();
  // Subtraction avoids overflow for valid but very large pagination offsets.
  return {
    items: rows.map(map),
    total,
    hasMore: total - offset > limit,
  };
}
