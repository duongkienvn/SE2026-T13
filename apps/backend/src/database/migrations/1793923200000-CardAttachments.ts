import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CardAttachments1793923200000 implements MigrationInterface {
  name = 'CardAttachments1793923200000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE card_attachments (
id uuid CONSTRAINT "PK_card_attachments" PRIMARY KEY DEFAULT gen_random_uuid(),
card_id uuid NOT NULL, board_id uuid NOT NULL, uploader_id uuid NOT NULL,
kind varchar(4) NOT NULL, state varchar(7) NOT NULL, display_name varchar(120) NOT NULL,
url varchar(2048), original_filename varchar(255), pending_key varchar(128), storage_key varchar(128),
requested_mime_type varchar(120), reserved_bytes bigint, mime_type varchar(120), byte_size bigint,
idempotency_key uuid, request_hash varchar(64), expires_at timestamptz, verified_at timestamptz,
revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
CONSTRAINT "FK_card_attachments_card_board" FOREIGN KEY (card_id, board_id) REFERENCES cards(id, board_id) ON DELETE CASCADE,
CONSTRAINT "FK_card_attachments_uploader" FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE RESTRICT,
CONSTRAINT "CHK_card_attachments_identity" CHECK (kind IN ('URL','FILE') AND state IN ('PENDING','ACTIVE','FAILED','EXPIRED','REMOVED') AND revision > 0),
CONSTRAINT "CHK_card_attachments_name" CHECK (display_name = btrim(display_name) AND display_name <> '' AND display_name !~ '[[:cntrl:]]'),
CONSTRAINT "CHK_card_attachments_url_shape" CHECK (kind <> 'URL' OR (state IN ('ACTIVE','REMOVED') AND url IS NOT NULL AND url ~ '^https://[^/@[:space:]?#]+([/?#]|$)' AND url !~ '[[:cntrl:][:space:]]' AND position(chr(92) in url) = 0 AND length(url) <= 2048 AND original_filename IS NULL AND pending_key IS NULL AND storage_key IS NULL AND requested_mime_type IS NULL AND reserved_bytes IS NULL AND mime_type IS NULL AND byte_size IS NULL AND expires_at IS NULL AND verified_at IS NULL)),
CONSTRAINT "CHK_card_attachments_file_shape" CHECK (kind <> 'FILE' OR (url IS NULL AND original_filename IS NOT NULL AND original_filename <> '' AND original_filename !~ '[[:cntrl:]/]' AND position(chr(92) in original_filename) = 0 AND pending_key IS NOT NULL AND pending_key = 'attachments/v1/pending/' || id::text AND storage_key IS NOT NULL AND storage_key = 'attachments/v1/active/' || id::text AND requested_mime_type IS NOT NULL AND requested_mime_type <> '' AND reserved_bytes IS NOT NULL AND reserved_bytes BETWEEN 1 AND 9007199254740991 AND expires_at IS NOT NULL AND isfinite(expires_at) AND expires_at > created_at)),
CONSTRAINT "CHK_card_attachments_verified" CHECK ((verified_at IS NULL AND mime_type IS NULL AND byte_size IS NULL) OR (kind = 'FILE' AND verified_at IS NOT NULL AND isfinite(verified_at) AND mime_type IS NOT NULL AND mime_type = requested_mime_type AND byte_size IS NOT NULL AND byte_size = reserved_bytes)),
CONSTRAINT "CHK_card_attachments_file_state" CHECK (kind <> 'FILE' OR (state = 'ACTIVE' AND verified_at IS NOT NULL) OR state = 'REMOVED' OR (state IN ('PENDING','FAILED','EXPIRED') AND verified_at IS NULL)),
CONSTRAINT "CHK_card_attachments_idempotency" CHECK ((idempotency_key IS NULL AND request_hash IS NULL) OR (idempotency_key IS NOT NULL AND request_hash IS NOT NULL AND request_hash ~ '^[0-9a-f]{64}$'))
)`);
    await runner.query(
      `CREATE INDEX "IDX_card_attachments_active_page" ON card_attachments (card_id, created_at, id) WHERE state = 'ACTIVE'`,
    );
    await runner.query(
      `CREATE INDEX "IDX_card_attachments_board_state" ON card_attachments (board_id, state)`,
    );
    await runner.query(
      `CREATE INDEX "IDX_card_attachments_uploader" ON card_attachments (uploader_id)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX "UQ_card_attachments_idempotency" ON card_attachments (card_id, uploader_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX "UQ_card_attachments_pending_key" ON card_attachments (pending_key)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX "UQ_card_attachments_storage_key" ON card_attachments (storage_key)`,
    );
    await runner.query(`CREATE TABLE card_attachment_cleanup_jobs (
object_key varchar(128) CONSTRAINT "PK_card_attachment_cleanup_jobs" PRIMARY KEY,
attachment_id uuid NOT NULL, not_before timestamptz NOT NULL, next_attempt_at timestamptz NOT NULL,
attempts integer NOT NULL DEFAULT 0, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
CONSTRAINT "CHK_attachment_cleanup_key" CHECK (object_key IN ('attachments/v1/pending/' || attachment_id::text, 'attachments/v1/active/' || attachment_id::text)),
CONSTRAINT "CHK_attachment_cleanup_retry" CHECK (attempts >= 0 AND next_attempt_at >= not_before)
)`);
    await runner.query(
      `CREATE INDEX "IDX_attachment_cleanup_due" ON card_attachment_cleanup_jobs (next_attempt_at, object_key) WHERE completed_at IS NULL`,
    );
    await runner.query(`CREATE FUNCTION guard_card_attachment_update() RETURNS trigger LANGUAGE plpgsql AS $$
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
    await runner.query(
      `CREATE TRIGGER guard_card_attachment_update BEFORE UPDATE ON card_attachments FOR EACH ROW EXECUTE FUNCTION guard_card_attachment_update()`,
    );
    await runner.query(`CREATE FUNCTION queue_card_attachment_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
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
      `CREATE TRIGGER queue_card_attachment_cleanup AFTER INSERT OR UPDATE OR DELETE ON card_attachments FOR EACH ROW EXECUTE FUNCTION queue_card_attachment_cleanup()`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Attachment rollback requires a transaction');
    await runner.query(
      'LOCK TABLE card_attachments, card_attachment_cleanup_jobs IN ACCESS EXCLUSIVE MODE',
    );
    const [row] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM card_attachments) OR EXISTS(SELECT 1 FROM card_attachment_cleanup_jobs) AS populated',
    );
    if (row.populated)
      throw new Error(
        'Refusing to discard attachment metadata or cleanup obligations; back up and roll forward',
      );
    await runner.query('DROP TABLE card_attachments');
    await runner.query('DROP TABLE card_attachment_cleanup_jobs');
    await runner.query('DROP FUNCTION guard_card_attachment_update()');
    await runner.query('DROP FUNCTION queue_card_attachment_cleanup()');
  }
}
