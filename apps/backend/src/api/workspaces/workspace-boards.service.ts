import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceRole } from '@kanban/shared';
import { EntityManager, Repository } from 'typeorm';
import { Board } from '../boards/entities/board.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceBoardsQueryDto } from './dto/workspace-boards-query.dto';
import {
  WorkspaceBoardResponseDto,
  toWorkspaceBoardResponseDto,
} from './dto/workspace-board-response.dto';
import { WorkspaceOverviewDto } from './dto/workspace-overview.dto';
import { toWorkspaceResponseDto } from './dto/workspace-response.dto';
import {
  PaginatedResponse,
  paginate,
} from '../../common/dto/paginated-response';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { readWorkspaceSnapshot } from './workspace-read';
import {
  readableBoardPredicate,
  readableBoardParameters,
} from '../board-members/board-permissions';

@Injectable()
export class WorkspaceBoardsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly workspaces: WorkspacesService,
  ) {}

  private readableBoards(member: WorkspaceMember, manager: EntityManager) {
    return manager
      .getRepository(Board)
      .createQueryBuilder('board')
      .leftJoinAndSelect('board.members', 'actor', 'actor.userId = :userId', {
        userId: member.userId,
      })
      .where(readableBoardPredicate, readableBoardParameters(member.userId))
      .andWhere('board.workspaceId = :workspaceId', {
        workspaceId: member.workspaceId,
      });
  }

  list(
    userId: string,
    workspaceId: string,
    query: WorkspaceBoardsQueryDto,
  ): Promise<PaginatedResponse<WorkspaceBoardResponseDto>> {
    return readWorkspaceSnapshot(this.boards.manager, async (manager) => {
      const member = await this.workspaces.requireMember(
        userId,
        workspaceId,
        manager,
      );
      const builder = this.readableBoards(member, manager).andWhere(
        'board.isArchived = :archived',
        { archived: query.status === 'archived' },
      );
      if (query.search) {
        const literal = query.search.replace(/[\\%_]/g, '\\$&');
        builder.andWhere('board.name ILIKE :search', {
          search: `%${literal}%`,
        });
      }
      const page = await paginateQueryBuilder(
        builder,
        query,
        query.sort,
        query.sort === 'name' ? 'ASC' : 'DESC',
      );
      return paginate(
        page.data.map((board) =>
          toWorkspaceBoardResponseDto(board, board.members[0]?.role ?? null),
        ),
        page.meta.total,
        query,
      );
    });
  }

  overview(userId: string, workspaceId: string): Promise<WorkspaceOverviewDto> {
    return readWorkspaceSnapshot(this.boards.manager, async (manager) => {
      const member = await this.workspaces.requireMember(
        userId,
        workspaceId,
        manager,
      );
      const builder = this.readableBoards(member, manager);
      const visibleBoardCount = await builder.getCount();
      const archivedBoardCount = await builder
        .clone()
        .andWhere('board.isArchived = true')
        .getCount();
      const recent = await builder
        .orderBy('board.updatedAt', 'DESC')
        .addOrderBy('board.id', 'DESC')
        .take(5)
        .getMany();
      const memberCount =
        member.role === WorkspaceRole.ADMIN
          ? await manager
              .getRepository(WorkspaceMember)
              .countBy({ workspaceId: member.workspaceId })
          : null;
      return toResponseDto(WorkspaceOverviewDto, {
        workspace: toWorkspaceResponseDto(member),
        visibleBoardCount,
        activeBoardCount: visibleBoardCount - archivedBoardCount,
        archivedBoardCount,
        memberCount,
        recentBoards: recent.map((board) =>
          toWorkspaceBoardResponseDto(board, board.members[0]?.role ?? null),
        ),
      });
    });
  }
}
