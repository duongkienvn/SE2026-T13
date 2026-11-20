import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserNotification } from './entities/user-notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationService } from './notification.service';
import { NotificationInvitationResolvers } from './notification-invitation-resolvers';
import { PushEnqueuer } from '../push/push-enqueuer.service';

/** No Auth, mail, business modules or transport: safe for domain producers. */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserNotification, NotificationPreference]),
  ],
  providers: [
    NotificationService,
    NotificationInvitationResolvers,
    PushEnqueuer,
  ],
  exports: [
    TypeOrmModule,
    NotificationService,
    NotificationInvitationResolvers,
  ],
})
export class NotificationPersistenceModule {}
