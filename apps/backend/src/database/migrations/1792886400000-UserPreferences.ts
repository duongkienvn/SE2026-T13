import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserPreferences1792886400000 implements MigrationInterface {
  name = 'UserPreferences1792886400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE user_preferences (
      user_id uuid NOT NULL,
      theme varchar NOT NULL DEFAULT 'system',
      time_zone varchar(100) NOT NULL DEFAULT 'UTC',
      date_format varchar NOT NULL DEFAULT 'YYYY-MM-DD',
      week_starts_on varchar NOT NULL DEFAULT 'monday',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_user_preferences" PRIMARY KEY (user_id),
      CONSTRAINT "FK_user_preferences_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION,
      CONSTRAINT "CHK_user_preferences_theme" CHECK (theme IN ('light', 'dark', 'system')),
      CONSTRAINT "CHK_user_preferences_date_format" CHECK (date_format IN ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')),
      CONSTRAINT "CHK_user_preferences_week_start" CHECK (week_starts_on IN ('monday', 'sunday'))
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The migration transaction holds this lock through the guard and DROP.
    await queryRunner.query(
      'LOCK TABLE user_preferences IN ACCESS EXCLUSIVE MODE',
    );
    const [result]: { populated: boolean }[] = await queryRunner.query(
      'SELECT EXISTS(SELECT 1 FROM user_preferences) AS populated',
    );
    if (result.populated) {
      throw new Error(
        'Cannot revert user preferences while saved preferences exist. Keep the schema and roll back the application instead.',
      );
    }
    await queryRunner.query('DROP TABLE user_preferences');
  }
}
