import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceType } from '@kanban/shared';
import { EntityManager, Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';

/** Internal foundation. Callers supply trusted server identity, never client ownership. */
@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

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
