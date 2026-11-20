import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import type { EnvironmentConfig } from '../../config/environment';

/** Persistence only, called with the domain transaction and recipient lock. */
@Injectable()
export class PushEnqueuer {
  constructor(
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}
  async enqueue(
    manager: EntityManager,
    notificationId: string,
    recipient: string,
  ) {
    if (!this.config.get('PUSH_NOTIFICATIONS_ENABLED', { infer: true })) return;
    await manager.query(
      `INSERT INTO push_delivery_outbox(notification_id,device_id,recipient_user_id,enrollment_revision)
      SELECT $1,d.id,d.user_id,d.enrollment_revision FROM push_devices d
      JOIN user_push_preferences p ON p.user_id=d.user_id AND p.enabled
      JOIN users u ON u.id=d.user_id AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL AND u.auth_version=d.auth_version
      WHERE d.user_id=$2 AND d.active AND d.lease_until>clock_timestamp() AND d.session_expires_at>clock_timestamp()
      AND d.project_id=$3 AND d.app_environment=$4
      ON CONFLICT(notification_id,device_id) DO NOTHING`,
      [
        notificationId,
        recipient,
        this.config.get('PUSH_PROJECT_ID', { infer: true }),
        this.config.get('PUSH_APP_ENVIRONMENT', { infer: true }),
      ],
    );
  }
}
