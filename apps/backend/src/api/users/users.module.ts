import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserPreferences } from './entities/user-preferences.entity';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesService } from './user-preferences.service';
import { UserPreferencesBodyGuard } from './user-preferences-body.guard';
import { AvatarModule } from './avatars/avatar.module';
import { RealtimeAccessModule } from '../../realtime/realtime-access.module';
import { RealtimeDeliveryModule } from '../../realtime/realtime-delivery.module';
import { AccountDeletionController } from './account-deletion/account-deletion.controller';
import { AccountDeletionService } from './account-deletion/account-deletion.service';
import { AccountDeletionReauthenticationService } from './account-deletion/account-deletion-reauthentication.service';

@Module({
  imports: [
    AuthModule,
    AvatarModule,
    RealtimeAccessModule,
    RealtimeDeliveryModule,
    TypeOrmModule.forFeature([User, UserPreferences]),
  ],
  controllers: [
    UsersController,
    UserPreferencesController,
    AccountDeletionController,
  ],
  providers: [
    UsersService,
    UserPreferencesService,
    UserPreferencesBodyGuard,
    AccountDeletionService,
    AccountDeletionReauthenticationService,
  ],
})
export class UsersModule {}
