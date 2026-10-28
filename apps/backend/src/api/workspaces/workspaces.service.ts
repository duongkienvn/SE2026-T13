import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceRole, WorkspaceType } from '@kanban/shared';
import { EntityManager, Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';

/** Internal foundation. Callers supply trusted server identity, never client ownership. */
@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  /** Lock the grant until commit so removal/demotion cannot overtake a request. */
  async requireMember(
    userId: string,
    workspaceId: string,
    manager: EntityManager,
  ): Promise<WorkspaceMember> {
    const workspace = await manager.getRepository(Workspace).findOne({
      where: { id: workspaceId },
      lock: { mode: 'pessimistic_read' },
    });
    const member = await manager.getRepository(WorkspaceMember).findOne({
      where: { workspaceId, userId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!workspace || !member)
      throw new ApplicationException(
        404,
        ErrorCode.NOT_FOUND,
        'Workspace not found',
      );
    member.workspace = workspace;
    return member;
  }

  async requireAdmin(
    userId: string,
    workspaceId: string,
    manager: EntityManager,
  ): Promise<WorkspaceMember> {
    const member = await this.requireMember(userId, workspaceId, manager);
    if (member.role !== WorkspaceRole.ADMIN) {
      throw new ApplicationException(
        403,
        ErrorCode.FORBIDDEN,
        'Only Workspace ADMIN can perform this operation',
      );
    }
    return member;
  }

  findPersonalWorkspace(
    userId: string,
    manager?: EntityManager,
  ): Promise<Workspace | null> {
    return (manager?.getRepository(Workspace) ?? this.workspaces).findOneBy({
      type: WorkspaceType.PERSONAL,
      createdById: userId,
    });
  }

  /**
   * Without a manager, owns one transaction. With a manager, participates in the
   * caller's transaction so Workspace + ADMIN + Board + OWNER commit atomically.
   * PostgreSQL's partial unique index/upsert handles concurrent first use.
   */
  async ensurePersonalWorkspace(
    userId: string,
    manager?: EntityManager,
  ): Promise<Workspace> {
    if (!manager)
      return this.workspaces.manager.transaction((transaction) =>
        this.ensurePersonalWorkspace(userId, transaction),
      );
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error(
        'Personal Workspace provisioning requires an active transaction',
      );
    const [row]: { id: string }[] = await manager.query(
      'SELECT public.ensure_personal_workspace($1::uuid) AS id',
      [userId],
    );
    return manager.getRepository(Workspace).findOneByOrFail({ id: row.id });
  }
}
