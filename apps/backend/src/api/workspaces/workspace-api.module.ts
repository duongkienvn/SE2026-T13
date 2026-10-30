import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../../mail/mail.module';
import { AuthModule } from '../auth/auth.module';
import { Board } from '../boards/entities/board.entity';
import { Workspace } from './entities/workspace.entity';
import { WorkspacesModule } from './workspaces.module';
import { WorkspaceApiController } from './workspace-api.controller';
import { WorkspaceApiService } from './workspace-api.service';
import { WorkspaceBoardsService } from './workspace-boards.service';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspaceGuestsService } from './workspace-guests.service';
import { WorkspaceGuestsController } from './workspace-guests.controller';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import { WorkspaceInvitationIssuanceService } from './workspace-invitation-issuance.service';
import { WorkspaceInvitationDeclineGuard } from './workspace-invitation-decline.guard';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspacePoliciesController } from './workspace-policies.controller';
import { WorkspacePoliciesService } from './workspace-policies.service';
import { WorkspaceDeletionController } from './workspace-deletion.controller';
import { WorkspaceDeletionService } from './workspace-deletion.service';
import { BoardMembersModule } from '../board-members/board-members.module';
import { RealtimeAccessModule } from '../../realtime/realtime-access.module';
import {
  WorkspaceInvitationsController,
  WorkspaceInvitationAcceptanceController,
} from './workspace-invitations.controller';

@Module({
  imports: [
    BoardMembersModule,
    RealtimeAccessModule,
    AuthModule,
    MailModule,
    WorkspacesModule,
    TypeOrmModule.forFeature([Workspace, Board]),
  ],
  controllers: [
    WorkspaceApiController,
    WorkspaceMembersController,
    WorkspaceGuestsController,
    WorkspacePoliciesController,
    WorkspaceDeletionController,
    WorkspaceInvitationsController,
    WorkspaceInvitationAcceptanceController,
  ],
  providers: [
    WorkspaceApiService,
    WorkspaceBoardsService,
    WorkspaceMembersService,
    WorkspaceGuestsService,
    WorkspacePoliciesService,
    WorkspaceDeletionService,
    WorkspaceInvitationsService,
    WorkspaceInvitationIssuanceService,
    WorkspaceInvitationDeclineGuard,
  ],
})
export class WorkspaceApiModule {}
