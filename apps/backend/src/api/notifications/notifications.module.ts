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
import { NotificationReadBodyGuard } from './notification-read-body.guard';
import { MailModule } from '../../mail/mail.module';
import { DueReminderScanner } from './due-reminder-scanner.service';
import { TaskEmailDispatcher } from './task-email-dispatcher.service';
import { TaskNotificationWorker } from './task-notification-worker.service';

@Module({
  imports: [
    AuthModule,
    NotificationPersistenceModule,
    RealtimeDeliveryModule,
    MailModule,
  ],
  controllers: [NotificationPreferencesController, NotificationsController],
  providers: [
    DueReminderScanner,
    TaskEmailDispatcher,
    TaskNotificationWorker,
    NotificationPreferencesService,
    NotificationPreferencesBodyGuard,
    NotificationResolver,
    NotificationInboxService,
    NotificationReadBodyGuard,
    {
      provide: NotificationInvalidation,
      useExisting: NotificationEventPublisher,
    },
  ],
})
export class NotificationsModule {}
