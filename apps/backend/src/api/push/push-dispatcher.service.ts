import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { EnvironmentConfig } from '../../config/environment';
import { User } from '../users/entities/user.entity';
import { UserNotification } from '../notifications/entities/user-notification.entity';
import { NotificationPreference } from '../notifications/entities/notification-preference.entity';
import { IN_APP_KIND_COLUMN } from '../notifications/notification-preferences';
import { NotificationResolver } from '../notifications/notification-resolver.service';
import { PushDevice } from './entities/push-device.entity';
import { UserPushPreference } from './entities/user-push-preference.entity';
import { UserPushSchedule } from './entities/user-push-schedule.entity';
import { UserPreferences } from '../users/entities/user-preferences.entity';
import { isQuietAt, nextAllowedInstant } from './push-schedule-time';
import {
  PushDeliveryOutbox,
  type PushStatus,
} from './entities/push-delivery-outbox.entity';
import {
  ExpoPushProvider,
  type SendResult,
  type ReceiptResult,
} from './expo-push.provider';
import { PushTokenCipher } from './push-token';
import { tokenContext, cancelDeviceJobs } from './push-registry.service';

export const pushRetryDelay = (attempt: number, random = Math.random()) =>
  Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 900_000) +
  Math.floor(Math.max(0, Math.min(1, random)) * 15_000);
type Claimed = { id: string; status: 'PROCESSING' | 'RECEIPT_PROCESSING' };
@Injectable()
export class PushDispatcher {
  private readonly owner = randomUUID();
  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService<EnvironmentConfig, true>,
    private readonly provider: ExpoPushProvider,
    private readonly resolver: NotificationResolver,
  ) {}
  private get enabled() {
    return this.config.get('PUSH_NOTIFICATIONS_ENABLED', { infer: true });
  }
  async drain() {
    if (!this.enabled) return;
    await this.maintain();
    // Claim one at a time; a slow provider cannot exhaust the batch's leases.
    for (let i = 0; i < 25; i++) {
      const [rows]: [Claimed[], number] = await this.source.query(
        `WITH ready AS (
        SELECT j.id FROM push_delivery_outbox j
        WHERE j.status IN ('PENDING','TICKET') AND j.expires_at>clock_timestamp()
        AND (j.next_attempt_at<=clock_timestamp() OR (
          j.status='PENDING' AND j.last_error_code='QUIET_HOURS' AND (
            NOT EXISTS (SELECT 1 FROM user_push_schedules s WHERE s.user_id=j.recipient_user_id AND s.enabled)
            OR EXISTS (
              SELECT 1 FROM user_push_schedules s
              LEFT JOIN user_preferences p ON p.user_id=s.user_id
              CROSS JOIN LATERAL (SELECT to_char(clock_timestamp() AT TIME ZONE COALESCE(p.time_zone,'UTC'),'HH24:MI') AS wall) t
              WHERE s.user_id=j.recipient_user_id AND s.enabled AND NOT (
                CASE WHEN s.start_local<s.end_local THEN t.wall>=s.start_local AND t.wall<s.end_local
                ELSE t.wall>=s.start_local OR t.wall<s.end_local END
              )
            )
          )
        ))
        ORDER BY j.next_attempt_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
      ) UPDATE push_delivery_outbox j SET status=CASE WHEN j.status='PENDING' THEN 'PROCESSING' ELSE 'RECEIPT_PROCESSING' END,
        attempted_at=CASE WHEN j.status='PENDING' THEN NULL ELSE j.attempted_at END,
        lease_owner=$1,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
        FROM ready WHERE j.id=ready.id RETURNING j.id,j.status`,
        [this.owner],
      );
      if (!rows.length) break;
      const prepared = await this.prepare(rows[0]);
      if (!prepared) continue;
      // Decision/attempt committed before external HTTPS, never under domain locks.
      // An opt-out after this boundary cannot recall an already in-flight alert.
      let result: SendResult | ReceiptResult;
      try {
        result = prepared.receipt
          ? await this.provider.receipt(prepared.ticket!)
          : await this.provider.send(prepared.token!, prepared.notificationId);
      } catch {
        result = prepared.receipt
          ? { type: 'retry', code: 'PROVIDER_UNAVAILABLE' }
          : { type: 'unknown', code: 'SEND_UNCERTAIN' };
      }
      await this.finish(prepared.job, result, prepared.receipt);
    }
  }
  private async prepare(claim: Claimed) {
    return this.source.transaction(async (m) => {
      const snapshot = await m
        .getRepository(PushDeliveryOutbox)
        .findOneBy({ id: claim.id });
      if (!snapshot) return;
      const notification = await m
        .getRepository(UserNotification)
        .findOneBy({ id: snapshot.notificationId });
      // Match domain ordering: Board -> workspace membership -> User -> device -> job.
      if (notification?.boardId)
        await m.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
          notification.boardId,
        ]);
      if (notification?.workspaceId && !notification.boardId)
        await m.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE', [
          notification.workspaceId,
        ]);
      if (notification?.boardId)
        await m.query(
          `SELECT wm.user_id FROM workspace_members wm JOIN boards b ON b.workspace_id=wm.workspace_id
           WHERE b.id=$1 AND wm.user_id=$2 FOR KEY SHARE OF wm`,
          [notification.boardId, snapshot.recipientUserId],
        );
      else if (notification?.workspaceId)
        await m.query(
          'SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR KEY SHARE',
          [notification.workspaceId, snapshot.recipientUserId],
        );
      const user = await m.getRepository(User).findOne({
        where: { id: snapshot.recipientUserId },
        lock: { mode: 'for_no_key_update' },
      });
      const device = await m.getRepository(PushDevice).findOne({
        where: { id: snapshot.deviceId },
        lock: { mode: 'pessimistic_write' },
        select: {
          id: true,
          userId: true,
          active: true,
          authVersion: true,
          leaseUntil: true,
          sessionExpiresAt: true,
          enrollmentRevision: true,
          projectId: true,
          appEnvironment: true,
          installationId: true,
          tokenFingerprint: true,
          encryptedToken: true,
        },
      });
      const job = await m.getRepository(PushDeliveryOutbox).findOne({
        where: { id: claim.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !job ||
        job.leaseOwner !== this.owner ||
        job.status !== claim.status ||
        !job.leaseUntil ||
        job.leaseUntil.getTime() <= Date.now()
      )
        return;
      const account = await m
        .getRepository(UserPushPreference)
        .findOneBy({ userId: job.recipientUserId });
      const prefs = await m
        .getRepository(NotificationPreference)
        .findOneBy({ userId: job.recipientUserId });
      let eligible =
        this.enabled &&
        !!notification &&
        notification.recipientUserId === job.recipientUserId &&
        !!user &&
        !user.deletedAt &&
        !!user.emailVerifiedAt &&
        !!account?.enabled &&
        !!device?.active &&
        device.userId === job.recipientUserId &&
        device.enrollmentRevision === job.enrollmentRevision &&
        user.authVersion === device.authVersion &&
        device.leaseUntil.getTime() > Date.now() &&
        device.sessionExpiresAt.getTime() > Date.now() &&
        device.projectId ===
          this.config.get('PUSH_PROJECT_ID', { infer: true }) &&
        device.appEnvironment ===
          this.config.get('PUSH_APP_ENVIRONMENT', { infer: true }) &&
        job.expiresAt.getTime() > Date.now() &&
        prefs?.[IN_APP_KIND_COLUMN[notification.kind]] !== false;
      if (eligible && notification) {
        const resolved = await this.resolver.resolve(m, job.recipientUserId, [
          notification,
        ]);
        eligible = !!resolved[0] && !resolved[0].isUnavailable;
        if (notification.boardId) {
          const [live] = (await m.query(
            'SELECT is_archived FROM boards WHERE id=$1',
            [notification.boardId],
          )) as { is_archived: boolean }[];
          eligible &&= !!live && !live.is_archived;
        }
        if (notification.cardId) {
          const [live] = (await m.query(
            'SELECT is_archived FROM cards WHERE id=$1',
            [notification.cardId],
          )) as { is_archived: boolean }[];
          eligible &&= !!live && !live.is_archived;
        }
      }
      if (!eligible) {
        await this.setState(m, job.id, 'CANCELLED', 'INELIGIBLE');
        return;
      }
      const receipt = claim.status === 'RECEIPT_PROCESSING';
      if (receipt) {
        if (!job.ticketId || job.receiptAttempts >= 16) {
          await this.setState(m, job.id, 'UNKNOWN', 'RECEIPT_EXPIRED');
          return;
        }
        await m
          .getRepository(PushDeliveryOutbox)
          .update(job.id, { receiptAttempts: job.receiptAttempts + 1 });
        return {
          job,
          receipt: true,
          ticket: job.ticketId,
          notificationId: job.notificationId,
        };
      }
      // The User lock above also serializes account timezone/schedule updates.
      // Read only here: receipt polling is never delayed by quiet hours.
      const schedule = await m.getRepository(UserPushSchedule).findOneBy({
        userId: job.recipientUserId,
      });
      if (schedule?.enabled) {
        const preferences = await m.getRepository(UserPreferences).findOneBy({
          userId: job.recipientUserId,
        });
        const [{ now }]: { now: Date }[] = await m.query(
          'SELECT clock_timestamp() AS now',
        );
        const zone = preferences?.timeZone ?? 'UTC';
        if (isQuietAt(now, zone, schedule.startLocal, schedule.endLocal)) {
          const allowed = nextAllowedInstant(
            now,
            zone,
            schedule.startLocal,
            schedule.endLocal,
          );
          if (allowed >= job.expiresAt) {
            await this.setState(m, job.id, 'CANCELLED', 'EXPIRED');
          } else {
            // No attempt consumed, no TTL extension or new enqueue. Save the exact
            // permitted instant; claim can wake early only for authoritative edits.
            await m.query(
              `UPDATE push_delivery_outbox SET status='PENDING',last_error_code='QUIET_HOURS',
               lease_owner=NULL,lease_until=NULL,next_attempt_at=$2,updated_at=clock_timestamp() WHERE id=$1`,
              [job.id, allowed],
            );
          }
          return;
        }
      }
      if (job.attempts >= 6) {
        await this.setState(m, job.id, 'FAILED', 'ATTEMPTS_EXHAUSTED');
        return;
      }
      const [rate] = (await m.query(
        `SELECT
        COALESCE(sum(attempts) FILTER (WHERE device_id=$2),0)::int AS device,
        COALESCE(sum(attempts),0)::int AS recipient,
        count(*) FILTER (WHERE device_id=$2 AND attempted_at>clock_timestamp()-interval '1 second')::int AS recent
        FROM push_delivery_outbox WHERE recipient_user_id=$1 AND created_at>clock_timestamp()-interval '24 hours'`,
        [job.recipientUserId, job.deviceId],
      )) as { device: number; recipient: number; recent: number }[];
      if (rate.device >= 100 || rate.recipient >= 200) {
        await this.setState(m, job.id, 'CANCELLED', 'RATE_LIMIT');
        return;
      }
      if (rate.recent) {
        await this.setState(m, job.id, 'PENDING', null, 2_000);
        return;
      }
      let token: string;
      try {
        token = new PushTokenCipher(
          this.config.get('PUSH_TOKEN_ENCRYPTION_KEY', { infer: true }),
        ).decrypt(device!.encryptedToken, tokenContext(device!));
      } catch {
        await this.setState(m, job.id, 'FAILED', 'TOKEN_INVALID');
        await m.getRepository(PushDevice).update(device!.id, { active: false });
        await cancelDeviceJobs(m, device!.id);
        return;
      }
      await m.query(
        'UPDATE push_delivery_outbox SET attempts=attempts+1,attempted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',
        [job.id],
      );
      job.attempts++;
      return { job, receipt: false, token, notificationId: job.notificationId };
    });
  }
  private async finish(
    job: PushDeliveryOutbox,
    result: SendResult | ReceiptResult,
    receipt: boolean,
  ) {
    await this.source.transaction(async (m) => {
      // Same user/device/job order as registration. A transfer can cancel the
      // claimed revision while HTTPS is in flight; never touch its new owner.
      await m.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [
        job.recipientUserId,
      ]);
      const device = await m.getRepository(PushDevice).findOne({
        where: { id: job.deviceId },
        lock: { mode: 'pessimistic_write' },
      });
      const current = await m.getRepository(PushDeliveryOutbox).findOne({
        where: { id: job.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !current ||
        current.leaseOwner !== this.owner ||
        !['PROCESSING', 'RECEIPT_PROCESSING'].includes(current.status)
      )
        return;
      if (result.type === 'ticket') {
        await m.query(
          `UPDATE push_delivery_outbox SET status='TICKET',ticket_id=$2,next_attempt_at=clock_timestamp()+interval '15 minutes',lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1`,
          [job.id, result.ticketId],
        );
      } else if (result.type === 'accepted')
        await this.setState(m, job.id, 'ACCEPTED', null);
      else if (result.type === 'unknown')
        await this.setState(m, job.id, 'UNKNOWN', result.code);
      else if (result.type === 'rejected') {
        // A definitive receipt rejection permits a bounded new send. Poll
        // failures/missing receipts above never resend an accepted ticket.
        await m
          .getRepository(PushDeliveryOutbox)
          .update(job.id, { ticketId: null, receiptAttempts: 0 });
        await this.setState(
          m,
          job.id,
          current.attempts >= 6 ? 'FAILED' : 'PENDING',
          result.code,
          pushRetryDelay(current.attempts),
        );
      } else if (result.type === 'pending' || result.type === 'retry') {
        const exhausted = receipt
          ? current.receiptAttempts >= 16
          : current.attempts >= 6;
        await this.setState(
          m,
          job.id,
          exhausted
            ? receipt
              ? 'UNKNOWN'
              : 'FAILED'
            : receipt
              ? 'TICKET'
              : 'PENDING',
          result.type === 'retry' ? result.code : 'RECEIPT_PENDING',
          receipt ? 15 * 60_000 : pushRetryDelay(current.attempts),
        );
      } else if (result.type === 'permanent') {
        await this.setState(m, job.id, 'FAILED', result.code);
        if (
          result.code === 'DEVICE_NOT_REGISTERED' &&
          device?.enrollmentRevision === job.enrollmentRevision &&
          device.userId === job.recipientUserId
        ) {
          await m
            .getRepository(PushDevice)
            .update(device.id, { active: false });
          await cancelDeviceJobs(m, device.id);
        }
      }
    });
  }
  private async setState(
    m: EntityManager,
    id: string,
    status: PushStatus,
    code: string | null,
    delay = 0,
  ) {
    await m.query(
      `UPDATE push_delivery_outbox SET status=$2,last_error_code=$3,lease_owner=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+($4*interval '1 millisecond'),updated_at=clock_timestamp() WHERE id=$1`,
      [id, status, code, delay],
    );
  }
  private async maintain() {
    await this.source
      .query(`DELETE FROM push_devices WHERE id IN (SELECT id FROM push_devices
      WHERE lease_until<clock_timestamp()-interval '7 days' LIMIT 200 FOR UPDATE SKIP LOCKED)`);
    await this.source
      .query(`DELETE FROM push_device_revocations WHERE (user_id,installation_id) IN
      (SELECT user_id,installation_id FROM push_device_revocations WHERE session_expires_through<clock_timestamp() LIMIT 200 FOR UPDATE SKIP LOCKED)`);
    await this.source
      .query(`UPDATE push_delivery_outbox SET status=CASE WHEN status='RECEIPT_PROCESSING' THEN 'TICKET' WHEN attempted_at IS NOT NULL THEN 'UNKNOWN' ELSE 'PENDING' END,
      last_error_code=CASE WHEN status='PROCESSING' AND attempted_at IS NULL AND last_error_code='QUIET_HOURS' THEN 'QUIET_HOURS' ELSE 'LEASE_EXPIRED' END,lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE id IN (SELECT id FROM push_delivery_outbox WHERE status IN ('PROCESSING','RECEIPT_PROCESSING') AND lease_until<clock_timestamp() LIMIT 200 FOR UPDATE SKIP LOCKED)`);
    await this.source
      .query(`UPDATE push_delivery_outbox SET status=CASE WHEN status IN ('TICKET','RECEIPT_PROCESSING') THEN 'UNKNOWN' ELSE 'CANCELLED' END,last_error_code='EXPIRED',lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE id IN (SELECT id FROM push_delivery_outbox WHERE status IN ('PENDING','TICKET') AND expires_at<=clock_timestamp() LIMIT 200 FOR UPDATE SKIP LOCKED)`);
    await this.source.query(
      `DELETE FROM push_delivery_outbox WHERE id IN (SELECT id FROM push_delivery_outbox WHERE status IN ('ACCEPTED','FAILED','CANCELLED','UNKNOWN') AND updated_at<clock_timestamp()-interval '7 days' LIMIT 200 FOR UPDATE SKIP LOCKED)`,
    );
  }
  async releaseOwned() {
    if (!this.enabled) return;
    await this.source.query(
      `UPDATE push_delivery_outbox SET status=CASE WHEN status='RECEIPT_PROCESSING' THEN 'TICKET' WHEN attempted_at IS NOT NULL THEN 'UNKNOWN' ELSE 'PENDING' END,
      lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE lease_owner=$1 AND status IN ('PROCESSING','RECEIPT_PROCESSING')`,
      [this.owner],
    );
  }
}
