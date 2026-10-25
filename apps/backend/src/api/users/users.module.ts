import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserPreferences } from './entities/user-preferences.entity';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesService } from './user-preferences.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([User, UserPreferences])],
  controllers: [UsersController, UserPreferencesController],
  providers: [UsersService, UserPreferencesService],
})
export class UsersModule {}
