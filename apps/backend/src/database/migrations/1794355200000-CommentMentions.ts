import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommentMentions1794355200000 implements MigrationInterface {
  name = 'CommentMentions1794355200000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE comment_mentions (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      comment_id uuid NOT NULL,
      user_id uuid NOT NULL,
      start_offset integer NOT NULL,
      end_offset integer NOT NULL,
      CONSTRAINT "PK_comment_mentions_id" PRIMARY KEY (id),
      CONSTRAINT "FK_comment_mentions_comment" FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      CONSTRAINT "FK_comment_mentions_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION,
      CONSTRAINT "CK_comment_mentions_offsets" CHECK (start_offset >= 0 AND end_offset > start_offset AND end_offset <= 4000),
      CONSTRAINT "UQ_comment_mentions_span" UNIQUE (comment_id, start_offset, end_offset)
    )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_comment_mentions_comment_id" ON comment_mentions (comment_id)',
    );
  }
  async down(): Promise<void> {
    throw new Error('Comment mentions migration is forward-only');
  }
}
