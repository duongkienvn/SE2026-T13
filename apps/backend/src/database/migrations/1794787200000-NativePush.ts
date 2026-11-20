import type { MigrationInterface, QueryRunner } from 'typeorm';
export class NativePush1794787200000 implements MigrationInterface {
  name = 'NativePush1794787200000';
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE user_push_preferences (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await r.query(`CREATE TABLE push_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      installation_id uuid NOT NULL UNIQUE,
      token_fingerprint varchar(64) NOT NULL UNIQUE CHECK (token_fingerprint ~ '^[0-9a-f]{64}$'),
      encrypted_token text NOT NULL CHECK (encrypted_token LIKE 'v1.%'),
      platform varchar(7) NOT NULL CHECK (platform IN ('android','ios')),
      app_environment varchar(11) NOT NULL CHECK (app_environment IN ('development','preview','production')),
      project_id uuid NOT NULL, active boolean NOT NULL DEFAULT true,
      auth_version integer NOT NULL, session_expires_at timestamptz NOT NULL,
      enrollment_revision uuid NOT NULL, retired_sessions jsonb NOT NULL DEFAULT '{}',
      lease_until timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await r.query(
      'CREATE INDEX "IDX_push_devices_user" ON push_devices (user_id, active)',
    );
    await r.query(`CREATE TABLE push_delivery_outbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id uuid NOT NULL REFERENCES user_notifications(id) ON DELETE CASCADE,
      device_id uuid NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
      recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enrollment_revision uuid NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','TICKET','RECEIPT_PROCESSING','ACCEPTED','FAILED','CANCELLED','UNKNOWN')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
      receipt_attempts integer NOT NULL DEFAULT 0 CHECK (receipt_attempts BETWEEN 0 AND 16),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      lease_owner uuid, lease_until timestamptz, attempted_at timestamptz,
      ticket_id varchar(100), expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
      last_error_code varchar(32), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(notification_id, device_id),
      CHECK ((status IN ('PROCESSING','RECEIPT_PROCESSING')) = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
    )`);
    await r.query(
      'CREATE INDEX "IDX_push_outbox_ready" ON push_delivery_outbox (status, next_attempt_at, id)',
    );
    await r.query(
      'CREATE INDEX "IDX_push_outbox_device" ON push_delivery_outbox (device_id, status)',
    );
    await r.query(
      'CREATE INDEX "IDX_push_outbox_recipient" ON push_delivery_outbox (recipient_user_id, attempted_at)',
    );
  }
  async down(): Promise<void> {
    throw new Error('Native push requires a forward fix');
  }
}
