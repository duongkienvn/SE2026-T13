import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Board } from '../boards/entities/board.entity';
import { BoardUserState } from '../boards/entities/board-user-state.entity';
import { BoardMember } from '../board-members/entities/board-member.entity';
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
  pageOffset,
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
      .leftJoinAndMapOne(
        'board.userState',
        BoardUserState,
        'userState',
        'userState.boardId = board.id AND userState.userId = :userId',
        { userId: member.userId },
      )
      .innerJoinAndSelect('board.workspace', 'boardWorkspace')
      .leftJoinAndSelect('board.members', 'actor', 'actor.userId = :userId', {
        userId: member.userId,
      })
      .where(readableBoardPredicate, readableBoardParameters(member.userId))
      .andWhere('board.workspaceId = :workspaceId', {
        workspaceId: member.workspaceId,
      });
  }

  /** One aggregate over only returned Boards whose roster this actor may read. */
  private async summaries(boards: Board[], manager: EntityManager) {
    const boardIds = boards
      .filter((board) => board.members[0] !== undefined)
      .map((board) => board.id);
    const counts = boardIds.length
      ? await manager
          .getRepository(BoardMember)
          .createQueryBuilder('summaryMember')
          .select('summaryMember.boardId', 'boardId')
          .addSelect('COUNT(*)::int', 'memberCount')
          .where('summaryMember.boardId IN (:...boardIds)', { boardIds })
          .groupBy('summaryMember.boardId')
          .getRawMany<{ boardId: string; memberCount: number }>()
      : [];
    const byBoard = new Map(
      counts.map((row) => [row.boardId, row.memberCount]),
    );
    return boards.map((board) =>
      toWorkspaceBoardResponseDto(
        board,
        board.members[0]?.role ?? null,
        byBoard.get(board.id) ?? null,
      ),
    );
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
      const search = query.q ?? query.search;
      if (search) {
        const literal = search.replace(/[\\%_]/g, '\\$&');
        builder.andWhere('board.name ILIKE :search', {
          search: `%${literal}%`,
        });
      }
      if (query.starred !== undefined)
        builder.andWhere(
          query.starred
            ? 'userState.isStarred = true'
            : 'COALESCE(userState.isStarred, false) = false',
        );
      if (query.recent) builder.andWhere('userState.lastViewedAt IS NOT NULL');
      if (query.sort === 'recent') {
        const [rows, total] = await builder
          .orderBy('userState.lastViewedAt', 'DESC', 'NULLS LAST')
          .addOrderBy('board.id', 'DESC')
          .skip(pageOffset(query))
          .take(query.limit)
          .getManyAndCount();
        return paginate(await this.summaries(rows, manager), total, query);
      }
      const page = await paginateQueryBuilder(
        builder,
        query,
        query.sort,
        query.sort === 'name' ? 'ASC' : 'DESC',
      );
      return paginate(
        await this.summaries(page.data, manager),
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
      const memberCount = await manager
        .getRepository(WorkspaceMember)
        .countBy({ workspaceId: member.workspaceId });
      return toResponseDto(WorkspaceOverviewDto, {
        workspace: toWorkspaceResponseDto(member),
        visibleBoardCount,
        activeBoardCount: visibleBoardCount - archivedBoardCount,
        archivedBoardCount,
        memberCount,
        recentBoards: await this.summaries(recent, manager),
      });
    });
  }
}
