import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import { WorkspaceInvitationIssuanceService } from './workspace-invitation-issuance.service';
import { WorkspaceInvitationsController } from './workspace-invitations.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Board } from '../boards/entities/board.entity';
import { Workspace } from './entities/workspace.entity';
import { WorkspacesModule } from './workspaces.module';
import { WorkspaceApiController } from './workspace-api.controller';
import { WorkspaceApiService } from './workspace-api.service';
import { WorkspaceBoardsService } from './workspace-boards.service';

@Module({
  imports: [
    AuthModule,
    WorkspacesModule,
    TypeOrmModule.forFeature([Workspace, Board]),
  ],
  controllers: [
    WorkspaceApiController,
    WorkspaceMembersController,
    WorkspaceInvitationsController,
  ],
  providers: [
    WorkspaceApiService,
    WorkspaceBoardsService,
    WorkspaceMembersService,
    WorkspaceInvitationsService,
    WorkspaceInvitationIssuanceService,
  ],
})
export class WorkspaceApiModule {}
