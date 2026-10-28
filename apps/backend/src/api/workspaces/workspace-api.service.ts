import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceRole, WorkspaceType } from '@kanban/shared';
import { Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspacesService } from './workspaces.service';
import {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
} from './dto/workspace-input.dto';
import {
  WorkspaceResponseDto,
  toWorkspaceResponseDto,
} from './dto/workspace-response.dto';
import { WorkspacePageQueryDto } from './dto/workspace-page-query.dto';
import {
  PaginatedResponse,
  paginate,
} from '../../common/dto/paginated-response';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';
import { readWorkspaceSnapshot } from './workspace-read';

@Injectable()
export class WorkspaceApiService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly foundation: WorkspacesService,
  ) {}

  async list(
    userId: string,
    query: WorkspacePageQueryDto,
  ): Promise<PaginatedResponse<WorkspaceResponseDto>> {
    await this.foundation.ensurePersonalWorkspace(userId);
    return readWorkspaceSnapshot(this.workspaces.manager, async (manager) => {
      const page = await paginateQueryBuilder(
        manager
          .getRepository(WorkspaceMember)
          .createQueryBuilder('member')
          .innerJoinAndSelect('member.workspace', 'workspace')
          .where('member.userId = :userId', { userId }),
        query,
        'joinedAt',
        'ASC',
      );
      return paginate(
        page.data.map(toWorkspaceResponseDto),
        page.meta.total,
        query,
      );
    });
  }

  detail(userId: string, workspaceId: string): Promise<WorkspaceResponseDto> {
    return this.workspaces.manager.transaction(async (manager) =>
      toWorkspaceResponseDto(
        await this.foundation.requireMember(userId, workspaceId, manager),
      ),
    );
  }

  personal(userId: string): Promise<WorkspaceResponseDto> {
    return this.workspaces.manager.transaction(async (manager) => {
      const workspace = await this.foundation.ensurePersonalWorkspace(
        userId,
        manager,
      );
      return toWorkspaceResponseDto(
        await this.foundation.requireMember(userId, workspace.id, manager),
      );
    });
  }

  create(
    userId: string,
    input: CreateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    return this.workspaces.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Workspace);
      const workspace = await repository.save(
        repository.create({
          type: WorkspaceType.TEAM,
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? null,
          createdById: userId,
        }),
      );
      const members = manager.getRepository(WorkspaceMember);
      const member = await members.save(
        members.create({
          workspaceId: workspace.id,
          userId,
          role: WorkspaceRole.ADMIN,
        }),
      );
      member.workspace = workspace;
      return toWorkspaceResponseDto(member);
    });
  }

  update(
    userId: string,
    workspaceId: string,
    input: UpdateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.icon === undefined
    ) {
      throw new ApplicationException(
        400,
        ErrorCode.VALIDATION_FAILED,
        'At least one Workspace field must be provided',
      );
    }
    return this.workspaces.manager.transaction(async (manager) => {
      // Lock Workspace before membership, in the same order as Personal ensure.
      await manager.getRepository(Workspace).findOne({
        where: { id: workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      const member = await this.foundation.requireAdmin(
        userId,
        workspaceId,
        manager,
      );
      const workspace = member.workspace;
      if (input.name !== undefined) workspace.name = input.name;
      if (input.description !== undefined)
        workspace.description = input.description;
      if (input.icon !== undefined) workspace.icon = input.icon;
      member.workspace = await manager.getRepository(Workspace).save(workspace);
      return toWorkspaceResponseDto(member);
    });
  }
}
