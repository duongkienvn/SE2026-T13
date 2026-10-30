import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { User } from '../users/entities/user.entity';
import { Workspace } from './entities/workspace.entity';
import { WorkspacesService } from './workspaces.service';
import { readWorkspaceSnapshot } from './workspace-read';
import {
  paginate,
  type PaginatedResponse,
} from '../../common/dto/paginated-response';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import {
  toWorkspaceGuestDto,
  WorkspaceGuestBoardDto,
  WorkspaceGuestResponseDto,
  WorkspaceGuestsQueryDto,
} from './dto/workspace-guests.dto';

@Injectable()
export class WorkspaceGuestsService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly foundation: WorkspacesService,
  ) {}

  /** Same roster boundary as BoardAuthorizationService.requireMember(), not requireRead(). */
  private eligibleMemberships(
    manager: EntityManager,
    actor: string,
    workspaceId: string,
  ) {
    return manager
      .getRepository(BoardMember)
      .createQueryBuilder('guest')
      .innerJoin('guest.board', 'board')
      .innerJoin('board.members', 'actor', 'actor.userId = :actor', { actor })
      .where('board.workspaceId = :workspaceId', { workspaceId })
      .andWhere(`NOT EXISTS (
        SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = :workspaceId AND wm.user_id = guest.user_id
      )`);
  }

  list(
    actor: string,
    workspaceId: string,
    query: WorkspaceGuestsQueryDto,
  ): Promise<PaginatedResponse<WorkspaceGuestResponseDto>> {
    return readWorkspaceSnapshot(this.workspaces.manager, async (manager) => {
      await this.foundation.requireMember(actor, workspaceId, manager);
      const eligible = this.eligibleMemberships(manager, actor, workspaceId)
        .select('1')
        .andWhere('guest.userId = user.id');
      // EXISTS keeps one row per user before count/order/offset, regardless of Board count.
      const users = manager
        .getRepository(User)
        .createQueryBuilder('user')
        .select([
          'user.id',
          'user.displayName',
          'user.avatarUrl',
          'user.avatarObjectKey',
        ])
        .where(`EXISTS (${eligible.getQuery()})`, eligible.getParameters());
      if (query.search)
        users.andWhere('user.displayName ILIKE :search', {
          search: `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
        });
      const page = await paginateQueryBuilder(
        users,
        query,
        'displayName',
        'ASC',
      );
      if (!page.data.length) return paginate([], page.meta.total, query);

      // One bulk association query for the page, with the identical SQL ACL boundary.
      const associations = await this.eligibleMemberships(
        manager,
        actor,
        workspaceId,
      )
        .andWhere('guest.userId IN (:...userIds)', {
          userIds: page.data.map((user) => user.id),
        })
        .select('guest.userId', 'userId')
        .addSelect('board.id', 'boardId')
        .addSelect('board.name', 'name')
        .addSelect('guest.role', 'role')
        .addSelect('board.isArchived', 'isArchived')
        .orderBy('board.name', 'ASC')
        .addOrderBy('board.id', 'ASC')
        .getRawMany<WorkspaceGuestBoardDto & { userId: string }>();
      const byUser = new Map<string, WorkspaceGuestBoardDto[]>();
      for (const association of associations) {
        const boards = byUser.get(association.userId) ?? [];
        boards.push(association);
        byUser.set(association.userId, boards);
      }
      return paginate(
        page.data.map((user) =>
          toWorkspaceGuestDto(user, byUser.get(user.id) ?? []),
        ),
        page.meta.total,
        query,
      );
    });
  }
}
