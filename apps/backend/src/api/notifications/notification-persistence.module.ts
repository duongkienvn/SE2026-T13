import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserNotification } from './entities/user-notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';

/** No Auth, mail, business modules or transport: safe for domain producers. */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserNotification, NotificationPreference]),
  ],
  exports: [TypeOrmModule],
})
export class NotificationPersistenceModule {}
