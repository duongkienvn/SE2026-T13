import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeDeliveryModule } from '../../realtime/realtime-delivery.module';
import { NotificationEventPublisher } from '../../realtime/notification-event-publisher.service';
import { NotificationPersistenceModule } from './notification-persistence.module';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreferencesBodyGuard } from './notification-preferences-body.guard';
import { NotificationResolver } from './notification-resolver.service';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationsController } from './notifications.controller';
import { NotificationInvalidation } from './notification-invalidation';

@Module({
  imports: [AuthModule, NotificationPersistenceModule, RealtimeDeliveryModule],
  controllers: [NotificationPreferencesController, NotificationsController],
  providers: [
    NotificationPreferencesService,
    NotificationPreferencesBodyGuard,
    NotificationResolver,
    NotificationInboxService,
    {
      provide: NotificationInvalidation,
      useExisting: NotificationEventPublisher,
    },
  ],
})
export class NotificationsModule {}
