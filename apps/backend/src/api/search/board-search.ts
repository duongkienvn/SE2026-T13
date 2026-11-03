import { Workspace } from '../workspaces/entities/workspace.entity';
import { Board } from '../boards/entities/board.entity';
import {
  readableBoardParameters,
  readableBoardPredicate,
} from '../board-members/board-permissions';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { BoardSearchResultDto } from './dto/search-response.dto';
import type { SearchQueryDto } from './dto/search-query.dto';
import type { EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { searchPage, searchParameters } from './search-query';

/** A Board read grant does not grant its Workspace directory/name. This JOIN
 * projects null in SQL for Guests, independently of the Board ACL below.
 */
export function joinReadableWorkspace<Entity extends ObjectLiteral>(
  query: SelectQueryBuilder<Entity>,
) {
  return query.leftJoin(
    Workspace,
    'directory',
    `directory.id = board.workspace_id AND EXISTS (
    SELECT 1 FROM workspace_members directory_member
    WHERE directory_member.workspace_id = directory.id AND directory_member.user_id = :userId
  )`,
  );
}

export function searchBoards(
  manager: EntityManager,
  userId: string,
  input: SearchQueryDto,
) {
  const base = joinReadableWorkspace(
    manager.getRepository(Board).createQueryBuilder('board'),
  )
    .where(readableBoardPredicate, readableBoardParameters(userId))
    .andWhere('board.isArchived = false')
    .andWhere(
      "board.name ILIKE :contains ESCAPE '\\'",
      searchParameters(input.q),
    )
    .select('board.id', 'id')
    .addSelect('board.name', 'title')
    .addSelect('board.workspaceId', 'workspaceId')
    .addSelect('directory.name', 'workspaceName');
  return searchPage(
    base,
    input,
    { title: 'board.name', updatedAt: 'board.updatedAt', id: 'board.id' },
    (row: {
      id: string;
      title: string;
      workspaceId: string;
      workspaceName: string | null;
    }) =>
      toResponseDto(BoardSearchResultDto, {
        type: 'board',
        ...row,
        subtitle: row.workspaceName,
        path: `/boards/${row.id}`,
      }),
  );
}
