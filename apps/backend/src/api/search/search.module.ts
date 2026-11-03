import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Workspace])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
