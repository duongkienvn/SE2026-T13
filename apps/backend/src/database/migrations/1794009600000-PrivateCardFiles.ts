import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PrivateCardFiles1794009600000 implements MigrationInterface {
  name = 'PrivateCardFiles1794009600000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE card_attachments ADD COLUMN declared_bytes bigint, ADD COLUMN content_sha256 varchar(64), ADD COLUMN intent_auth_version integer, ADD COLUMN verification_token uuid, ADD COLUMN verification_expires_at timestamptz`,
    );
    await runner.query(
      `UPDATE card_attachments SET declared_bytes=reserved_bytes,revision=revision+1 WHERE kind='FILE'`,
    );
    await runner.query(
      `ALTER TABLE card_attachments DROP CONSTRAINT "CHK_card_attachments_verified"`,
    );
    await runner.query(
      `ALTER TABLE card_attachments ADD CONSTRAINT "CHK_card_attachments_verified" CHECK ((verified_at IS NULL AND mime_type IS NULL AND byte_size IS NULL) OR (kind = 'FILE' AND verified_at IS NOT NULL AND isfinite(verified_at) AND mime_type IS NOT NULL AND mime_type = requested_mime_type AND byte_size IS NOT NULL AND byte_size BETWEEN 1 AND reserved_bytes))`,
    );
    await runner.query(
      `ALTER TABLE card_attachments ADD CONSTRAINT "CHK_card_attachments_integrity" CHECK ((kind = 'URL' AND declared_bytes IS NULL AND content_sha256 IS NULL AND intent_auth_version IS NULL) OR (kind = 'FILE' AND declared_bytes IS NOT NULL AND declared_bytes BETWEEN 1 AND reserved_bytes AND (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$') AND (intent_auth_version IS NULL OR intent_auth_version >= 0)))`,
    );
    await runner.query(
      `ALTER TABLE card_attachments ADD CONSTRAINT "CHK_card_attachments_verification_lease" CHECK ((verification_token IS NULL AND verification_expires_at IS NULL) OR (kind = 'FILE' AND state = 'PENDING' AND verification_token IS NOT NULL AND verification_expires_at IS NOT NULL AND isfinite(verification_expires_at) AND verification_expires_at <= expires_at))`,
    );
    await runner.query(
      `CREATE INDEX "IDX_card_attachments_pending_expiry" ON card_attachments(expires_at,id) WHERE kind='FILE' AND state='PENDING'`,
    );
    await runner.query(`DROP INDEX "IDX_attachment_cleanup_due"`);
    await runner.query(
      `CREATE INDEX "IDX_attachment_cleanup_due" ON card_attachment_cleanup_jobs(next_attempt_at,object_key)`,
    );
    await runner.query(`CREATE OR REPLACE FUNCTION guard_card_attachment_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.card_id,NEW.board_id,NEW.uploader_id,NEW.kind,NEW.pending_key,NEW.storage_key,
         NEW.original_filename,NEW.requested_mime_type,NEW.reserved_bytes,NEW.expires_at,
         NEW.idempotency_key,NEW.request_hash,NEW.created_at,NEW.declared_bytes,NEW.intent_auth_version)
     IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.board_id,OLD.uploader_id,OLD.kind,OLD.pending_key,OLD.storage_key,
         OLD.original_filename,OLD.requested_mime_type,OLD.reserved_bytes,OLD.expires_at,
         OLD.idempotency_key,OLD.request_hash,OLD.created_at,OLD.declared_bytes,OLD.intent_auth_version) THEN
    RAISE EXCEPTION 'Attachment identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Attachment revision must advance' USING ERRCODE = '23514';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state = 'PENDING' AND NEW.state IN ('ACTIVE','FAILED','EXPIRED','REMOVED')) OR
    (OLD.state = 'ACTIVE' AND NEW.state = 'REMOVED') OR
    (OLD.state IN ('FAILED','EXPIRED') AND NEW.state = 'REMOVED')
  ) THEN
    RAISE EXCEPTION 'Invalid attachment state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$`);
    await runner.query(`INSERT INTO card_attachment_cleanup_jobs(object_key,attachment_id,not_before,next_attempt_at)
SELECT key,id,GREATEST(expires_at,now())+interval '1 hour',GREATEST(expires_at,now())+interval '1 hour'
FROM card_attachments CROSS JOIN LATERAL (VALUES(pending_key),(storage_key)) keys(key) WHERE kind='FILE'
ON CONFLICT(object_key) DO UPDATE SET not_before=GREATEST(card_attachment_cleanup_jobs.not_before,EXCLUDED.not_before),next_attempt_at=GREATEST(card_attachment_cleanup_jobs.next_attempt_at,EXCLUDED.not_before),completed_at=NULL`);
    await runner.query(`CREATE OR REPLACE FUNCTION queue_card_attachment_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset card_attachments%ROWTYPE; due_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN asset := OLD; ELSE asset := NEW; END IF;
  IF asset.kind = 'FILE' THEN
    due_at := GREATEST(asset.expires_at, now()) + interval '1 hour';
    IF TG_OP = 'INSERT' THEN
      -- Permanent unique ownership tombstones also prohibit reusing deleted FILE IDs.
      INSERT INTO card_attachment_cleanup_jobs(object_key,attachment_id,not_before,next_attempt_at)
        VALUES (asset.pending_key,asset.id,due_at,due_at),(asset.storage_key,asset.id,due_at,due_at);
    ELSE
      INSERT INTO card_attachment_cleanup_jobs(object_key,attachment_id,not_before,next_attempt_at)
        VALUES (asset.pending_key,asset.id,due_at,due_at),(asset.storage_key,asset.id,due_at,due_at)
        ON CONFLICT (object_key) DO UPDATE SET
          not_before=GREATEST(card_attachment_cleanup_jobs.not_before,EXCLUDED.not_before),
          next_attempt_at=GREATEST(card_attachment_cleanup_jobs.next_attempt_at,EXCLUDED.not_before), completed_at=NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Private attachment rollback requires a transaction');
    await runner.query(
      `LOCK TABLE card_attachments,card_attachment_cleanup_jobs IN ACCESS EXCLUSIVE MODE`,
    );
    const [row] = await runner.query(
      "SELECT EXISTS(SELECT 1 FROM card_attachments WHERE kind='FILE') OR EXISTS(SELECT 1 FROM card_attachment_cleanup_jobs) AS populated",
    );
    if (row.populated)
      throw new Error(
        'Refusing to discard attachment metadata or cleanup obligations; private files require roll-forward',
      );
    await runner.query(`CREATE OR REPLACE FUNCTION guard_card_attachment_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.card_id,NEW.board_id,NEW.uploader_id,NEW.kind,NEW.pending_key,NEW.storage_key,
         NEW.original_filename,NEW.requested_mime_type,NEW.reserved_bytes,NEW.expires_at,
         NEW.idempotency_key,NEW.request_hash,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.board_id,OLD.uploader_id,OLD.kind,OLD.pending_key,OLD.storage_key,
         OLD.original_filename,OLD.requested_mime_type,OLD.reserved_bytes,OLD.expires_at,
         OLD.idempotency_key,OLD.request_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'Attachment identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Attachment revision must advance' USING ERRCODE = '23514';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state = 'PENDING' AND NEW.state IN ('ACTIVE','FAILED','EXPIRED','REMOVED')) OR
    (OLD.state = 'ACTIVE' AND NEW.state = 'REMOVED') OR
    (OLD.state IN ('FAILED','EXPIRED') AND NEW.state = 'REMOVED')
  ) THEN
    RAISE EXCEPTION 'Invalid attachment state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$`);
    await runner.query(`CREATE OR REPLACE FUNCTION queue_card_attachment_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset card_attachments%ROWTYPE; due_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN asset := OLD; ELSE asset := NEW; END IF;
  IF asset.kind = 'FILE' AND (TG_OP = 'DELETE' OR asset.state IN ('ACTIVE','FAILED','EXPIRED','REMOVED')) THEN
    due_at := GREATEST(asset.expires_at, now());
    INSERT INTO card_attachment_cleanup_jobs(object_key,attachment_id,not_before,next_attempt_at)
      VALUES (asset.pending_key,asset.id,due_at,due_at) ON CONFLICT (object_key) DO NOTHING;
    IF TG_OP = 'DELETE' OR asset.state <> 'ACTIVE' THEN
      INSERT INTO card_attachment_cleanup_jobs(object_key,attachment_id,not_before,next_attempt_at)
        VALUES (asset.storage_key,asset.id,due_at,due_at) ON CONFLICT (object_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END $$`);
    await runner.query(
      `ALTER TABLE card_attachments DROP CONSTRAINT "CHK_card_attachments_integrity", DROP CONSTRAINT "CHK_card_attachments_verification_lease", DROP CONSTRAINT "CHK_card_attachments_verified"`,
    );
    await runner.query(
      `ALTER TABLE card_attachments ADD CONSTRAINT "CHK_card_attachments_verified" CHECK ((verified_at IS NULL AND mime_type IS NULL AND byte_size IS NULL) OR (kind = 'FILE' AND verified_at IS NOT NULL AND isfinite(verified_at) AND mime_type IS NOT NULL AND mime_type = requested_mime_type AND byte_size IS NOT NULL AND byte_size = reserved_bytes))`,
    );
    await runner.query(`DROP INDEX "IDX_card_attachments_pending_expiry"`);
    await runner.query(`DROP INDEX "IDX_attachment_cleanup_due"`);
    await runner.query(
      `CREATE INDEX "IDX_attachment_cleanup_due" ON card_attachment_cleanup_jobs(next_attempt_at,object_key) WHERE completed_at IS NULL`,
    );
    await runner.query(
      `ALTER TABLE card_attachments DROP COLUMN declared_bytes, DROP COLUMN content_sha256, DROP COLUMN intent_auth_version, DROP COLUMN verification_token, DROP COLUMN verification_expires_at`,
    );
  }
}
