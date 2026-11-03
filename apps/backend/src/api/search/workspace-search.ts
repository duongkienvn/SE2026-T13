import type { EntityManager } from 'typeorm';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { WorkspaceSearchResultDto } from './dto/search-response.dto';
import type { SearchQueryDto } from './dto/search-query.dto';
import { searchPage, searchParameters } from './search-query';

export function searchWorkspaces(
  manager: EntityManager,
  userId: string,
  input: SearchQueryDto,
) {
  const base = manager
    .getRepository(Workspace)
    .createQueryBuilder('workspace')
    .where(
      'EXISTS (SELECT 1 FROM workspace_members membership WHERE membership.workspace_id = workspace.id AND membership.user_id = :userId)',
      { userId },
    )
    .andWhere(
      "workspace.name ILIKE :contains ESCAPE '\\'",
      searchParameters(input.q),
    )
    .select('workspace.id', 'id')
    .addSelect('workspace.name', 'title');
  return searchPage(
    base,
    input,
    {
      title: 'workspace.name',
      updatedAt: 'workspace.updatedAt',
      id: 'workspace.id',
    },
    (row: { id: string; title: string }) =>
      toResponseDto(WorkspaceSearchResultDto, {
        type: 'workspace',
        ...row,
        subtitle: null,
        path: `/workspaces/${row.id}`,
      }),
  );
}
