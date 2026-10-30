import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceRole } from '@kanban/shared';
import { Repository, type EntityManager } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { User } from '../users/entities/user.entity';
import { WorkspacesService } from './workspaces.service';
import { lockWorkspace, requireTeam } from './workspace-access';
import { readWorkspaceSnapshot } from './workspace-read';
import {
  toWorkspaceMemberDto,
  WorkspaceMembersQueryDto,
} from './dto/workspace-members.dto';
import { paginate } from '../../common/dto/paginated-response';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { ErrorCode } from '../../common/dto/api-error';
import { ApplicationException } from '../../exceptions/application.exception';
import { Board } from '../boards/entities/board.entity';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { BoardRoomCoordinator } from '../../realtime/board-room-coordinator.service';

@Injectable()
export class WorkspaceMembersService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly foundation: WorkspacesService,
    private readonly authorization: BoardAuthorizationService,
    private readonly coordinator: BoardRoomCoordinator,
  ) {}

  list(actor: string, workspaceId: string, query: WorkspaceMembersQueryDto) {
    return readWorkspaceSnapshot(this.workspaces.manager, async (manager) => {
      await this.foundation.requireMember(actor, workspaceId, manager);
      const builder = manager
        .getRepository(WorkspaceMember)
        .createQueryBuilder('member')
        .innerJoinAndSelect('member.user', 'user')
        .where('member.workspaceId = :workspaceId', { workspaceId });
      if (query.role)
        builder.andWhere('member.role = :role', { role: query.role });
      if (query.search)
        builder.andWhere('user.displayName ILIKE :search', {
          search: `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
        });
      const page = await paginateQueryBuilder(
        builder,
        query,
        'joinedAt',
        'ASC',
      );
      return paginate(
        page.data.map(toWorkspaceMemberDto),
        page.meta.total,
        query,
      );
    });
  }

  changeRole(
    actor: string,
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ) {
    return this.workspaces.manager.transaction(async (manager) => {
      await lockWorkspace(manager, workspaceId);
      const admin = await this.foundation.requireAdmin(
        actor,
        workspaceId,
        manager,
      );
      requireTeam(admin.workspace);
      if (!Object.values(WorkspaceRole).includes(role))
        throw new ApplicationException(
          400,
          ErrorCode.VALIDATION_FAILED,
          'Invalid Workspace role',
        );
      const repository = manager.getRepository(WorkspaceMember);
      const target = await repository.findOne({
        where: { workspaceId, userId },
        relations: { user: true },
      });
      if (!target)
        throw new ApplicationException(
          404,
          ErrorCode.NOT_FOUND,
          'Member not found',
        );
      if (role !== target.role) {
        if (actor === userId)
          throw new ApplicationException(
            409,
            ErrorCode.CONFLICT,
            'Ask another ADMIN to change your role',
          );
        await this.protectLastAdmin(manager, target);
        await repository.update(target.id, { role });
        target.role = role;
      }
      return toWorkspaceMemberDto(target);
    });
  }

  remove(actor: string, workspaceId: string, userId: string) {
    return this.reconcileRemoval(workspaceId, userId, () =>
      this.workspaces.manager.transaction(async (manager) => {
        await lockWorkspace(manager, workspaceId);
        const admin = await this.foundation.requireAdmin(
          actor,
          workspaceId,
          manager,
        );
        requireTeam(admin.workspace);
        if (actor === userId)
          throw new ApplicationException(
            409,
            ErrorCode.CONFLICT,
            'Use Leave Workspace to remove yourself',
          );
        await this.deleteMember(manager, workspaceId, userId);
      }),
    );
  }

  leave(actor: string, workspaceId: string) {
    return this.reconcileRemoval(workspaceId, actor, () =>
      this.workspaces.manager.transaction(async (manager) => {
        const workspace = await lockWorkspace(manager, workspaceId);
        if (!workspace) return;
        const member = await manager
          .getRepository(WorkspaceMember)
          .findOneBy({ workspaceId, userId: actor });
        if (!member) return;
        requireTeam(workspace);
        await this.deleteMember(manager, workspaceId, actor);
      }),
    );
  }

  private async reconcileRemoval(
    workspaceId: string,
    userId: string,
    operation: () => Promise<void>,
  ) {
    return this.coordinator.withReadGrantChanges(async () => {
      const boards = await this.workspaces.manager.getRepository(Board).find({
        select: { id: true },
        where: { workspaceId },
      });
      return this.coordinator.runMany(
        boards.map((board) => board.id),
        async () => {
          await operation();
          this.coordinator.notifyWorkspaceRevoked(workspaceId, userId);
          for (const board of boards) {
            await this.coordinator.reconcileBoard(board.id, (userId) =>
              this.authorization.canReadBoard(userId, board.id),
            );
          }
        },
      );
    });
  }

  private async deleteMember(
    manager: EntityManager,
    workspaceId: string,
    userId: string,
  ) {
    const repository = manager.getRepository(WorkspaceMember);
    const member = await repository.findOneBy({ workspaceId, userId });
    if (!member) return;
    await this.protectLastAdmin(manager, member);
    const user = await manager
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    await manager.query(
      `UPDATE workspace_invitations SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE workspace_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND declined_at IS NULL
      AND (email = lower(btrim($2)) OR invited_by_id = $3)`,
      [workspaceId, user.email, userId],
    );
    await repository.delete(member.id);
  }

  private async protectLastAdmin(
    manager: EntityManager,
    member: WorkspaceMember,
  ) {
    if (
      member.role === WorkspaceRole.ADMIN &&
      (await manager.getRepository(WorkspaceMember).countBy({
        workspaceId: member.workspaceId,
        role: WorkspaceRole.ADMIN,
      })) <= 1
    )
      throw new ApplicationException(
        409,
        ErrorCode.CONFLICT,
        'Workspace must retain an ADMIN',
      );
  }
}
