import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialDatabaseFoundation1791763200000 implements MigrationInterface {
  name = 'InitialDatabaseFoundation1791763200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "board_members_role_enum" AS ENUM ('OWNER', 'MEMBER')`,
    );
    await queryRunner.query(`CREATE TYPE "activities_action_type_enum" AS ENUM (
      'BOARD_UPDATED', 'MEMBER_ADDED', 'MEMBER_REMOVED', 'ROLE_CHANGED',
      'COLUMN_CREATED', 'COLUMN_UPDATED', 'COLUMN_MOVED', 'COLUMN_DELETED',
      'CARD_CREATED', 'CARD_UPDATED', 'CARD_MOVED', 'CARD_ARCHIVED',
      'COMMENT_CREATED', 'COMMENT_UPDATED', 'COMMENT_DELETED'
    )`);
    await queryRunner.query(
      `CREATE TYPE "activities_entity_type_enum" AS ENUM ('BOARD', 'MEMBER', 'COLUMN', 'CARD', 'COMMENT')`,
    );

    await queryRunner.query(`CREATE TABLE "users" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "email" varchar NOT NULL,
      "password_hash" varchar NOT NULL,
      "display_name" varchar NOT NULL,
      "avatar_url" varchar,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_users" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_users_email" UNIQUE ("email")
    )`);
    await queryRunner.query(`CREATE TABLE "boards" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "name" varchar NOT NULL,
      "description" text,
      "created_by_id" uuid NOT NULL,
      "is_archived" boolean NOT NULL DEFAULT false,
      "archived_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_boards" PRIMARY KEY ("id"),
      CONSTRAINT "FK_boards_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION
    )`);
    await queryRunner.query(`CREATE TABLE "board_members" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "board_id" uuid NOT NULL,
      "user_id" uuid NOT NULL,
      "role" "board_members_role_enum" NOT NULL,
      "joined_at" timestamptz NOT NULL DEFAULT now(),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_board_members" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_board_members_board_id_user_id" UNIQUE ("board_id", "user_id"),
      CONSTRAINT "FK_board_members_board_id" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_board_members_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION
    )`);
    await queryRunner.query(`CREATE TABLE "board_columns" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "board_id" uuid NOT NULL,
      "name" varchar NOT NULL,
      "position" numeric(20,10) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_board_columns" PRIMARY KEY ("id"),
      CONSTRAINT "FK_board_columns_board_id" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE "cards" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "board_id" uuid NOT NULL,
      "column_id" uuid NOT NULL,
      "created_by_id" uuid NOT NULL,
      "title" varchar NOT NULL,
      "description" text,
      "position" numeric(20,10) NOT NULL,
      "due_date" timestamptz,
      "is_archived" boolean NOT NULL DEFAULT false,
      "archived_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_cards" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cards_board_id" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_cards_column_id" FOREIGN KEY ("column_id") REFERENCES "board_columns"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_cards_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION
    )`);
    await queryRunner.query(`CREATE TABLE "card_assignees" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "card_id" uuid NOT NULL,
      "user_id" uuid NOT NULL,
      "assigned_by_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_card_assignees" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_card_assignees_card_id_user_id" UNIQUE ("card_id", "user_id"),
      CONSTRAINT "FK_card_assignees_card_id" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_card_assignees_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION,
      CONSTRAINT "FK_card_assignees_assigned_by_id" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE NO ACTION
    )`);
    await queryRunner.query(`CREATE TABLE "comments" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "card_id" uuid NOT NULL,
      "author_id" uuid NOT NULL,
      "content" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz,
      CONSTRAINT "PK_comments" PRIMARY KEY ("id"),
      CONSTRAINT "FK_comments_card_id" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_comments_author_id" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION
    )`);
    await queryRunner.query(`CREATE TABLE "activities" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "board_id" uuid NOT NULL,
      "actor_id" uuid NOT NULL,
      "action_type" "activities_action_type_enum" NOT NULL,
      "entity_type" "activities_entity_type_enum" NOT NULL,
      "entity_id" uuid,
      "metadata" jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_activities" PRIMARY KEY ("id"),
      CONSTRAINT "FK_activities_board_id" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE NO ACTION,
      CONSTRAINT "FK_activities_actor_id" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION
    )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_board_members_user_id" ON "board_members" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_board_columns_board_id_position" ON "board_columns" ("board_id", "position")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cards_board_id_column_id" ON "cards" ("board_id", "column_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cards_column_id" ON "cards" ("column_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comments_card_id" ON "comments" ("card_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_activities_board_id_created_at" ON "activities" ("board_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "activities"`);
    await queryRunner.query(`DROP TABLE "comments"`);
    await queryRunner.query(`DROP TABLE "card_assignees"`);
    await queryRunner.query(`DROP TABLE "cards"`);
    await queryRunner.query(`DROP TABLE "board_columns"`);
    await queryRunner.query(`DROP TABLE "board_members"`);
    await queryRunner.query(`DROP TABLE "boards"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "activities_entity_type_enum"`);
    await queryRunner.query(`DROP TYPE "activities_action_type_enum"`);
    await queryRunner.query(`DROP TYPE "board_members_role_enum"`);
  }
}
