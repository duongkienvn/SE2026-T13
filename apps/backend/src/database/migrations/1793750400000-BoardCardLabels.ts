import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BoardCardLabels1793750400000 implements MigrationInterface {
  name = 'BoardCardLabels1793750400000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE cards ADD CONSTRAINT "UQ_cards_id_board_id" UNIQUE (id, board_id)',
    );
    await runner.query(`CREATE TABLE board_labels (
      id uuid CONSTRAINT "PK_board_labels" PRIMARY KEY DEFAULT gen_random_uuid(),
      board_id uuid NOT NULL,
      name varchar(120) NOT NULL,
      color varchar(7) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_board_labels_board_id" FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      CONSTRAINT "UQ_board_labels_id_board_id" UNIQUE (id, board_id),
      CONSTRAINT "CHK_board_labels_name" CHECK (name = btrim(name) AND name ~ '[^[:space:]]'),
      CONSTRAINT "CHK_board_labels_color" CHECK (color ~ '^#[0-9A-F]{6}$')
    )`);
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_board_labels_board_name" ON board_labels (board_id, lower(name))',
    );
    await runner.query(`CREATE TABLE card_labels (
      card_id uuid NOT NULL,
      label_id uuid NOT NULL,
      board_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_card_labels" PRIMARY KEY (card_id, label_id),
      CONSTRAINT "FK_card_labels_card_board" FOREIGN KEY (card_id, board_id) REFERENCES cards(id, board_id) ON DELETE CASCADE,
      CONSTRAINT "FK_card_labels_label_board" FOREIGN KEY (label_id, board_id) REFERENCES board_labels(id, board_id) ON DELETE CASCADE
    )`);
    await runner.query(
      'CREATE INDEX "IDX_card_labels_label_board" ON card_labels (label_id, board_id)',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Label rollback requires a transaction');
    await runner.query(
      'LOCK TABLE board_labels, card_labels IN ACCESS EXCLUSIVE MODE',
    );
    const [row] = await runner.query(
      'SELECT EXISTS (SELECT 1 FROM board_labels) AS populated',
    );
    if (row.populated)
      throw new Error(
        'Refusing to discard Board label data; back up and roll forward',
      );
    await runner.query('DROP TABLE card_labels');
    await runner.query('DROP TABLE board_labels');
    await runner.query(
      'ALTER TABLE cards DROP CONSTRAINT "UQ_cards_id_board_id"',
    );
  }
}
