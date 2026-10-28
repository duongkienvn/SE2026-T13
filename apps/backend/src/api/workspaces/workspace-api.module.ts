import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Workspace } from './entities/workspace.entity';
import { WorkspacesModule } from './workspaces.module';
import { WorkspaceApiController } from './workspace-api.controller';
import { WorkspaceApiService } from './workspace-api.service';

@Module({
  imports: [
    AuthModule,
    WorkspacesModule,
    TypeOrmModule.forFeature([Workspace]),
  ],
  controllers: [WorkspaceApiController],
  providers: [WorkspaceApiService],
})
export class WorkspaceApiModule {}
