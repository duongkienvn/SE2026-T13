import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CardChecklists1793664000000 implements MigrationInterface {
  name = 'CardChecklists1793664000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE card_checklists (
      id uuid CONSTRAINT "PK_card_checklists" PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id uuid NOT NULL,
      title varchar(120) NOT NULL,
      position numeric(20,10) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_card_checklists_card_id" FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      CONSTRAINT "CHK_card_checklists_text" CHECK (title = btrim(title) AND title ~ '[^[:space:]]'),
      CONSTRAINT "CHK_card_checklists_position" CHECK (position > 0),
      CONSTRAINT "UQ_card_checklists_parent_position" UNIQUE (card_id, position) DEFERRABLE INITIALLY DEFERRED
    )`);
    await runner.query(`CREATE TABLE card_checklist_items (
      id uuid CONSTRAINT "PK_card_checklist_items" PRIMARY KEY DEFAULT gen_random_uuid(),
      checklist_id uuid NOT NULL,
      text varchar(255) NOT NULL,
      is_checked boolean NOT NULL DEFAULT false,
      position numeric(20,10) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_card_checklist_items_checklist_id" FOREIGN KEY (checklist_id) REFERENCES card_checklists(id) ON DELETE CASCADE,
      CONSTRAINT "CHK_card_checklist_items_text" CHECK (text = btrim(text) AND text ~ '[^[:space:]]'),
      CONSTRAINT "CHK_card_checklist_items_position" CHECK (position > 0),
      CONSTRAINT "UQ_card_checklist_items_parent_position" UNIQUE (checklist_id, position) DEFERRABLE INITIALLY DEFERRED
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Checklist rollback requires a transaction');
    await runner.query(
      'LOCK TABLE card_checklists, card_checklist_items IN ACCESS EXCLUSIVE MODE',
    );
    const [row] = await runner.query(
      'SELECT EXISTS (SELECT 1 FROM card_checklists) AS populated',
    );
    if (row.populated)
      throw new Error(
        'Refusing to discard checklist data; back up and roll forward',
      );
    await runner.query('DROP TABLE card_checklist_items');
    await runner.query('DROP TABLE card_checklists');
  }
}
