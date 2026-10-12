import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import {
  PageQuery,
  PaginatedResponse,
  pageOffset,
  paginate,
} from '../common/dto/paginated-response';

/** The order field is supplied by server code and verified against entity metadata. */
export async function paginateQueryBuilder<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  query: PageQuery,
  orderField: Extract<keyof T, string>,
  direction: 'ASC' | 'DESC' = 'DESC',
): Promise<PaginatedResponse<T>> {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100
  ) {
    throw new RangeError('Pagination limit must be between 1 and 100');
  }
  const offset = pageOffset(query);
  if (
    builder.expressionMap.skip != null ||
    builder.expressionMap.take != null ||
    builder.expressionMap.offset != null ||
    builder.expressionMap.limit != null
  ) {
    throw new TypeError(
      'Offset pagination requires a query without existing pagination',
    );
  }
  const alias = builder.expressionMap.mainAlias;
  const metadata = alias?.metadata;
  const column = metadata?.findColumnWithPropertyPath(orderField);
  const primary = metadata?.primaryColumns[0];
  if (!alias || !column || !primary || metadata.primaryColumns.length !== 1) {
    throw new TypeError(
      'Pagination requires a mapped order field and one primary key',
    );
  }
  const queryBuilder = builder
    .clone()
    .orderBy(`${alias.name}.${column.propertyPath}`, direction)
    .skip(offset)
    .take(query.limit);
  if (column.propertyPath !== primary.propertyPath) {
    queryBuilder.addOrderBy(`${alias.name}.${primary.propertyPath}`, direction);
  }
  const [rows, total] = await queryBuilder.getManyAndCount();
  return paginate(rows, total, query);
}
