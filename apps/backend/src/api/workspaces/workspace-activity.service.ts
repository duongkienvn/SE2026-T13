import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceRole } from '@kanban/shared';
import { Repository } from 'typeorm';
import { WorkspaceActivity } from './entities/workspace-activity.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspacesService } from './workspaces.service';
import { WorkspacePageQueryDto } from './dto/workspace-page-query.dto';
import { readWorkspaceSnapshot } from './workspace-read';
import {
  readableBoardPredicate,
  readableBoardParameters,
} from '../board-members/board-permissions';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { paginate } from '../../common/dto/paginated-response';

@Injectable()
export class WorkspaceActivityService {
  constructor(
    @InjectRepository(WorkspaceActivity)
    private readonly activities: Repository<WorkspaceActivity>,
    private readonly workspaces: WorkspacesService,
  ) {}

  list(userId: string, workspaceId: string, query: WorkspacePageQueryDto) {
    return readWorkspaceSnapshot(this.activities.manager, async (manager) => {
      const member = await this.workspaces.requireMember(
        userId,
        workspaceId,
        manager,
      );
      const builder = manager
        .getRepository(WorkspaceActivity)
        .createQueryBuilder('activity')
        .leftJoin('activity.board', 'board')
        .addSelect(['board.id', 'board.name'])
        .leftJoin(
          WorkspaceMember,
          'actorMember',
          'actorMember.workspaceId = activity.workspaceId AND actorMember.userId = activity.actorId',
        )
        .leftJoin('activity.actor', 'actor', 'actor.id = actorMember.userId')
        .addSelect([
          'actor.id',
          'actor.displayName',
          'actor.avatarUrl',
          'actor.avatarObjectKey',
        ])
        .where('activity.workspaceId = :workspaceId', { workspaceId })
        .andWhere(
          `(activity.boardId IS NULL OR (board.workspaceId = activity.workspaceId AND ${readableBoardPredicate}
          AND board.activity_move_version = activity.board_move_version))`,
          readableBoardParameters(userId),
        );
      if (member.role !== WorkspaceRole.ADMIN)
        builder.andWhere('activity.eventType IN (:...memberTypes)', {
          memberTypes: [
            'WORKSPACE_CREATED',
            'WORKSPACE_UPDATED',
            'POLICY_UPDATED',
            'MEMBER_JOINED',
            'MEMBER_ROLE_CHANGED',
            'MEMBER_REMOVED',
            'MEMBER_LEFT',
            'BOARD_MOVED',
          ],
        });
      const page = await paginateQueryBuilder(builder, query, 'createdAt');
      return paginate(
        page.data.map((row) => {
          const user = row.actor;
          const objectId = user?.avatarObjectKey
            ?.split('/')
            .at(-1)
            ?.replace(/\.webp$/, '');
          return {
            id: row.id,
            eventType: row.eventType,
            createdAt: row.createdAt.toISOString(),
            actor: user
              ? {
                  id: user.id,
                  displayName: user.displayName,
                  avatarUrl: objectId
                    ? `/users/${user.id}/avatar/${objectId}`
                    : user.avatarUrl,
                }
              : null,
            board: row.board
              ? { id: row.board.id, name: row.board.name }
              : null,
          };
        }),
        page.meta.total,
        query,
      );
    });
  }
}
