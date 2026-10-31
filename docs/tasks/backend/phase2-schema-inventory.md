# Phase 2 PostgreSQL schema inventory

Generated from a disposable PostgreSQL 16 database by `test:phase2-integrity:database`.
Schema only; no application data. See [audit and policy findings](phase2-database-integrity.md).
The test compares this reviewed inventory to both fresh and upgraded catalogs.

## workspaces

| Column                           | PostgreSQL type          | Nullable | Default           |
| -------------------------------- | ------------------------ | -------- | ----------------- |
| id                               | uuid                     | false    | gen_random_uuid() |
| type                             | character varying        | false    | —                 |
| name                             | character varying(120)   | false    | —                 |
| description                      | text                     | true     | —                 |
| created_by_id                    | uuid                     | false    | —                 |
| created_at                       | timestamp with time zone | false    | now()             |
| updated_at                       | timestamp with time zone | false    | now()             |
| icon                             | character varying(16)    | true     | —                 |
| board_creation_admin_only        | boolean                  | false    | false             |
| board_invites_enabled            | boolean                  | false    | true              |
| board_membership_changes_enabled | boolean                  | false    | true              |
| board_visibility_changes_enabled | boolean                  | false    | true              |

| Constraint            | Kind | Definition                                                                                                                                                                                       | ON DELETE | Validated | Deferrable |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------- | ---------- |
| CK_workspaces_icon    | c    | CHECK (((icon)::text = ANY ((ARRAY['briefcase'::character varying, 'users'::character varying, 'code'::character varying, 'palette'::character varying, 'layers'::character varying])::text[]))) | —         | true      | false      |
| CK_workspaces_name    | c    | CHECK ((length(btrim((name)::text)) > 0))                                                                                                                                                        | —         | true      | false      |
| CK_workspaces_type    | c    | CHECK (((type)::text = ANY ((ARRAY['PERSONAL'::character varying, 'TEAM'::character varying])::text[])))                                                                                         | —         | true      | false      |
| FK_workspaces_creator | f    | FOREIGN KEY (created_by_id) REFERENCES users(id)                                                                                                                                                 | NO ACTION | true      | false      |
| PK_workspaces         | p    | PRIMARY KEY (id)                                                                                                                                                                                 | —         | true      | false      |

| Index                          | Definition                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| IDX_workspaces_created_by_id   | CREATE INDEX "IDX_workspaces_created_by_id" ON public.workspaces USING btree (created_by_id)                                                  |
| PK_workspaces                  | CREATE UNIQUE INDEX "PK_workspaces" ON public.workspaces USING btree (id)                                                                     |
| UQ_workspaces_personal_creator | CREATE UNIQUE INDEX "UQ_workspaces_personal_creator" ON public.workspaces USING btree (created_by_id) WHERE ((type)::text = 'PERSONAL'::text) |

Trigger workspace_activity_personal_created (enabled=O):

```sql
CREATE TRIGGER workspace_activity_personal_created AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION record_personal_workspace_creation()
```

## workspace_members

| Column       | PostgreSQL type          | Nullable | Default           |
| ------------ | ------------------------ | -------- | ----------------- |
| id           | uuid                     | false    | gen_random_uuid() |
| workspace_id | uuid                     | false    | —                 |
| user_id      | uuid                     | false    | —                 |
| role         | character varying        | false    | —                 |
| joined_at    | timestamp with time zone | false    | now()             |
| created_at   | timestamp with time zone | false    | now()             |
| updated_at   | timestamp with time zone | false    | now()             |

| Constraint                          | Kind | Definition                                                                                              | ON DELETE | Validated | Deferrable |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- | --------- | --------- | ---------- |
| CK_workspace_members_role           | c    | CHECK (((role)::text = ANY ((ARRAY['ADMIN'::character varying, 'MEMBER'::character varying])::text[]))) | —         | true      | false      |
| FK_workspace_members_user           | f    | FOREIGN KEY (user_id) REFERENCES users(id)                                                              | NO ACTION | true      | false      |
| FK_workspace_members_workspace      | f    | FOREIGN KEY (workspace_id) REFERENCES workspaces(id)                                                    | NO ACTION | true      | false      |
| PK_workspace_members                | p    | PRIMARY KEY (id)                                                                                        | —         | true      | false      |
| UQ_workspace_members_workspace_user | u    | UNIQUE (workspace_id, user_id)                                                                          | —         | true      | false      |

| Index                                | Definition                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| IDX_workspace_members_user_id        | CREATE INDEX "IDX_workspace_members_user_id" ON public.workspace_members USING btree (user_id)                            |
| IDX_workspace_members_workspace_role | CREATE INDEX "IDX_workspace_members_workspace_role" ON public.workspace_members USING btree (workspace_id, role)          |
| PK_workspace_members                 | CREATE UNIQUE INDEX "PK_workspace_members" ON public.workspace_members USING btree (id)                                   |
| UQ_workspace_members_workspace_user  | CREATE UNIQUE INDEX "UQ_workspace_members_workspace_user" ON public.workspace_members USING btree (workspace_id, user_id) |

## workspace_invitations

| Column        | PostgreSQL type          | Nullable | Default                          |
| ------------- | ------------------------ | -------- | -------------------------------- |
| id            | uuid                     | false    | gen_random_uuid()                |
| workspace_id  | uuid                     | false    | —                                |
| email         | character varying(320)   | false    | —                                |
| role          | character varying        | false    | —                                |
| token_hash    | character(64)            | false    | —                                |
| expires_at    | timestamp with time zone | false    | —                                |
| consumed_at   | timestamp with time zone | true     | —                                |
| revoked_at    | timestamp with time zone | true     | —                                |
| invited_by_id | uuid                     | false    | —                                |
| created_at    | timestamp with time zone | false    | now()                            |
| updated_at    | timestamp with time zone | false    | now()                            |
| send_state    | character varying(16)    | false    | 'UNAVAILABLE'::character varying |
| declined_at   | timestamp with time zone | true     | —                                |

| Constraint                           | Kind | Definition                                                                                                                                                                                                               | ON DELETE | Validated | Deferrable |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------- | ---------- |
| CK_workspace_invitations_declined_at | c    | CHECK (((declined_at IS NULL) OR ((declined_at >= created_at) AND (declined_at < expires_at))))                                                                                                                          | —         | true      | false      |
| CK_workspace_invitations_email       | c    | CHECK ((((email)::text = lower(btrim((email)::text))) AND ((email)::text ~ '^[^[:space:]@]+@[^[:space:]@]+$'::text)))                                                                                                    | —         | true      | false      |
| CK_workspace_invitations_expiry      | c    | CHECK ((expires_at > created_at))                                                                                                                                                                                        | —         | true      | false      |
| CK_workspace_invitations_hash        | c    | CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))                                                                                                                                                                            | —         | true      | false      |
| CK_workspace_invitations_role        | c    | CHECK (((role)::text = ANY ((ARRAY['ADMIN'::character varying, 'MEMBER'::character varying])::text[])))                                                                                                                  | —         | true      | false      |
| CK_workspace_invitations_send_state  | c    | CHECK (((send_state)::text = ANY ((ARRAY['UNAVAILABLE'::character varying, 'DISPATCHING'::character varying, 'SENT'::character varying, 'FAILED'::character varying, 'UNKNOWN'::character varying])::text[])))           | —         | true      | false      |
| CK_workspace_invitations_terminal    | c    | CHECK ((((consumed_at IS NULL) OR ((consumed_at >= created_at) AND (consumed_at < expires_at))) AND ((revoked_at IS NULL) OR (revoked_at >= created_at)) AND (num_nonnulls(consumed_at, revoked_at, declined_at) <= 1))) | —         | true      | false      |
| FK_workspace_invitations_inviter     | f    | FOREIGN KEY (invited_by_id) REFERENCES users(id)                                                                                                                                                                         | NO ACTION | true      | false      |
| FK_workspace_invitations_workspace   | f    | FOREIGN KEY (workspace_id) REFERENCES workspaces(id)                                                                                                                                                                     | NO ACTION | true      | false      |
| PK_workspace_invitations             | p    | PRIMARY KEY (id)                                                                                                                                                                                                         | —         | true      | false      |
| UQ_workspace_invitations_hash        | u    | UNIQUE (token_hash)                                                                                                                                                                                                      | —         | true      | false      |

| Index                                     | Definition                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IDX_workspace_invitations_created_at      | CREATE INDEX "IDX_workspace_invitations_created_at" ON public.workspace_invitations USING btree (created_at)                                                                                                 |
| IDX_workspace_invitations_expires_at      | CREATE INDEX "IDX_workspace_invitations_expires_at" ON public.workspace_invitations USING btree (expires_at)                                                                                                 |
| IDX_workspace_invitations_invited_by_id   | CREATE INDEX "IDX_workspace_invitations_invited_by_id" ON public.workspace_invitations USING btree (invited_by_id)                                                                                           |
| IDX_workspace_invitations_workspace_email | CREATE INDEX "IDX_workspace_invitations_workspace_email" ON public.workspace_invitations USING btree (workspace_id, email)                                                                                   |
| PK_workspace_invitations                  | CREATE UNIQUE INDEX "PK_workspace_invitations" ON public.workspace_invitations USING btree (id)                                                                                                              |
| UQ_workspace_invitations_hash             | CREATE UNIQUE INDEX "UQ_workspace_invitations_hash" ON public.workspace_invitations USING btree (token_hash)                                                                                                 |
| UQ_workspace_invitations_open_email       | CREATE UNIQUE INDEX "UQ_workspace_invitations_open_email" ON public.workspace_invitations USING btree (workspace_id, email) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL) AND (declined_at IS NULL)) |

## boards

| Column                | PostgreSQL type          | Nullable | Default                      |
| --------------------- | ------------------------ | -------- | ---------------------------- |
| id                    | uuid                     | false    | gen_random_uuid()            |
| name                  | character varying        | false    | —                            |
| description           | text                     | true     | —                            |
| created_by_id         | uuid                     | false    | —                            |
| is_archived           | boolean                  | false    | false                        |
| archived_at           | timestamp with time zone | true     | —                            |
| created_at            | timestamp with time zone | false    | now()                        |
| updated_at            | timestamp with time zone | false    | now()                        |
| workspace_id          | uuid                     | false    | —                            |
| visibility            | character varying        | false    | 'PRIVATE'::character varying |
| activity_move_version | integer                  | false    | 0                            |

| Constraint              | Kind | Definition                                                                                                                 | ON DELETE | Validated | Deferrable |
| ----------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- | --------- | --------- | ---------- |
| CK_boards_visibility    | c    | CHECK (((visibility)::text = ANY ((ARRAY['PRIVATE'::character varying, 'WORKSPACE_VISIBLE'::character varying])::text[]))) | —         | true      | false      |
| FK_boards_created_by_id | f    | FOREIGN KEY (created_by_id) REFERENCES users(id)                                                                           | NO ACTION | true      | false      |
| FK_boards_workspace     | f    | FOREIGN KEY (workspace_id) REFERENCES workspaces(id)                                                                       | NO ACTION | true      | false      |
| PK_boards               | p    | PRIMARY KEY (id)                                                                                                           | —         | true      | false      |

| Index                   | Definition                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- |
| IDX_boards_workspace_id | CREATE INDEX "IDX_boards_workspace_id" ON public.boards USING btree (workspace_id) |
| PK_boards               | CREATE UNIQUE INDEX "PK_boards" ON public.boards USING btree (id)                  |

Trigger TR_boards_workspace_bridge (enabled=O):

```sql
CREATE TRIGGER "TR_boards_workspace_bridge" BEFORE INSERT OR UPDATE ON public.boards FOR EACH ROW WHEN ((new.workspace_id IS NULL)) EXECUTE FUNCTION bridge_board_workspace()
```

Trigger board_activity_move_version (enabled=O):

```sql
CREATE TRIGGER board_activity_move_version BEFORE UPDATE OF workspace_id ON public.boards FOR EACH ROW WHEN ((old.workspace_id IS DISTINCT FROM new.workspace_id)) EXECUTE FUNCTION advance_board_activity_move_version()
```

## board_members

| Column     | PostgreSQL type          | Nullable | Default           |
| ---------- | ------------------------ | -------- | ----------------- |
| id         | uuid                     | false    | gen_random_uuid() |
| board_id   | uuid                     | false    | —                 |
| user_id    | uuid                     | false    | —                 |
| role       | board_members_role_enum  | false    | —                 |
| joined_at  | timestamp with time zone | false    | now()             |
| created_at | timestamp with time zone | false    | now()             |
| updated_at | timestamp with time zone | false    | now()             |

| Constraint                        | Kind | Definition                                                     | ON DELETE | Validated | Deferrable |
| --------------------------------- | ---- | -------------------------------------------------------------- | --------- | --------- | ---------- |
| FK_board_members_board_id         | f    | FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE | CASCADE   | true      | false      |
| FK_board_members_user_id          | f    | FOREIGN KEY (user_id) REFERENCES users(id)                     | NO ACTION | true      | false      |
| PK_board_members                  | p    | PRIMARY KEY (id)                                               | —         | true      | false      |
| UQ_board_members_board_id_user_id | u    | UNIQUE (board_id, user_id)                                     | —         | true      | false      |

| Index                             | Definition                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| IDX_board_members_user_id         | CREATE INDEX "IDX_board_members_user_id" ON public.board_members USING btree (user_id)                          |
| PK_board_members                  | CREATE UNIQUE INDEX "PK_board_members" ON public.board_members USING btree (id)                                 |
| UQ_board_members_board_id_user_id | CREATE UNIQUE INDEX "UQ_board_members_board_id_user_id" ON public.board_members USING btree (board_id, user_id) |

## board_workspace_moves

| Column                   | PostgreSQL type          | Nullable | Default           |
| ------------------------ | ------------------------ | -------- | ----------------- |
| id                       | uuid                     | false    | gen_random_uuid() |
| board_id                 | uuid                     | false    | —                 |
| actor_id                 | uuid                     | false    | —                 |
| source_workspace_id      | uuid                     | false    | —                 |
| destination_workspace_id | uuid                     | false    | —                 |
| old_visibility           | character varying        | false    | —                 |
| new_visibility           | character varying        | false    | —                 |
| created_at               | timestamp with time zone | false    | now()             |

| Constraint                          | Kind | Definition                                   | ON DELETE | Validated | Deferrable |
| ----------------------------------- | ---- | -------------------------------------------- | --------- | --------- | ---------- |
| board_workspace_moves_actor_id_fkey | f    | FOREIGN KEY (actor_id) REFERENCES users(id)  | NO ACTION | true      | false      |
| board_workspace_moves_board_id_fkey | f    | FOREIGN KEY (board_id) REFERENCES boards(id) | NO ACTION | true      | false      |
| board_workspace_moves_pkey          | p    | PRIMARY KEY (id)                             | —         | true      | false      |

| Index                      | Definition                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| board_workspace_moves_pkey | CREATE UNIQUE INDEX board_workspace_moves_pkey ON public.board_workspace_moves USING btree (id) |

## deleted_workspace_invitation_quota

| Column         | PostgreSQL type          | Nullable | Default |
| -------------- | ------------------------ | -------- | ------- |
| invitation_id  | uuid                     | false    | —       |
| actor_id       | uuid                     | false    | —       |
| recipient_hash | character(64)            | false    | —       |
| created_at     | timestamp with time zone | false    | —       |

| Constraint                              | Kind | Definition                  | ON DELETE | Validated | Deferrable |
| --------------------------------------- | ---- | --------------------------- | --------- | --------- | ---------- |
| deleted_workspace_invitation_quota_pkey | p    | PRIMARY KEY (invitation_id) | —         | true      | false      |

| Index                                             | Definition                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| IDX_deleted_workspace_invitation_quota_created_at | CREATE INDEX "IDX_deleted_workspace_invitation_quota_created_at" ON public.deleted_workspace_invitation_quota USING btree (created_at) |
| deleted_workspace_invitation_quota_pkey           | CREATE UNIQUE INDEX deleted_workspace_invitation_quota_pkey ON public.deleted_workspace_invitation_quota USING btree (invitation_id)   |

## workspace_activities

| Column             | PostgreSQL type          | Nullable | Default           |
| ------------------ | ------------------------ | -------- | ----------------- |
| id                 | uuid                     | false    | gen_random_uuid() |
| board_move_version | integer                  | true     | —                 |
| workspace_id       | uuid                     | false    | —                 |
| actor_id           | uuid                     | true     | —                 |
| event_type         | character varying(40)    | false    | —                 |
| board_id           | uuid                     | true     | —                 |
| created_at         | timestamp with time zone | false    | clock_timestamp() |

| Constraint                        | Kind | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ON DELETE | Validated | Deferrable |
| --------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- | ---------- |
| CK_workspace_activities_board     | c    | CHECK (((((event_type)::text = 'BOARD_MOVED'::text) AND (board_id IS NOT NULL) AND (board_move_version IS NOT NULL)) OR (((event_type)::text <> 'BOARD_MOVED'::text) AND (board_id IS NULL) AND (board_move_version IS NULL))))                                                                                                                                                                                                                                                                | —         | true      | false      |
| CK_workspace_activities_type      | c    | CHECK (((event_type)::text = ANY ((ARRAY['WORKSPACE_CREATED'::character varying, 'WORKSPACE_UPDATED'::character varying, 'POLICY_UPDATED'::character varying, 'MEMBER_JOINED'::character varying, 'MEMBER_ROLE_CHANGED'::character varying, 'MEMBER_REMOVED'::character varying, 'MEMBER_LEFT'::character varying, 'INVITATION_REQUESTED'::character varying, 'INVITATION_REVOKED'::character varying, 'INVITATION_DECLINED'::character varying, 'BOARD_MOVED'::character varying])::text[]))) | —         | true      | false      |
| FK_workspace_activities_actor     | f    | FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL                                                                                                                                                                                                                                                                                                                                                                                                                                 | SET NULL  | true      | false      |
| FK_workspace_activities_board     | f    | FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE                                                                                                                                                                                                                                                                                                                                                                                                                                 | CASCADE   | true      | false      |
| FK_workspace_activities_workspace | f    | FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE                                                                                                                                                                                                                                                                                                                                                                                                                         | CASCADE   | true      | false      |
| PK_workspace_activities           | p    | PRIMARY KEY (id)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —         | true      | false      |

| Index                          | Definition                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| IDX_workspace_activities_board | CREATE INDEX "IDX_workspace_activities_board" ON public.workspace_activities USING btree (board_id) WHERE (board_id IS NOT NULL)  |
| IDX_workspace_activities_order | CREATE INDEX "IDX_workspace_activities_order" ON public.workspace_activities USING btree (workspace_id, created_at DESC, id DESC) |
| PK_workspace_activities        | CREATE UNIQUE INDEX "PK_workspace_activities" ON public.workspace_activities USING btree (id)                                     |

## All inbound User, Board and Workspace foreign keys

| Table                     | Constraint                          | Definition                                                             | ON DELETE |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------------------- | --------- |
| activities                | FK_activities_actor_id              | FOREIGN KEY (actor_id) REFERENCES users(id)                            | NO ACTION |
| activities                | FK_activities_board_id              | FOREIGN KEY (board_id) REFERENCES boards(id)                           | NO ACTION |
| avatar_uploads            | FK_avatar_uploads_user              | FOREIGN KEY (user_id) REFERENCES users(id)                             | NO ACTION |
| board_columns             | FK_board_columns_board_id           | FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE         | CASCADE   |
| board_members             | FK_board_members_board_id           | FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE         | CASCADE   |
| board_members             | FK_board_members_user_id            | FOREIGN KEY (user_id) REFERENCES users(id)                             | NO ACTION |
| board_workspace_moves     | board_workspace_moves_actor_id_fkey | FOREIGN KEY (actor_id) REFERENCES users(id)                            | NO ACTION |
| board_workspace_moves     | board_workspace_moves_board_id_fkey | FOREIGN KEY (board_id) REFERENCES boards(id)                           | NO ACTION |
| boards                    | FK_boards_created_by_id             | FOREIGN KEY (created_by_id) REFERENCES users(id)                       | NO ACTION |
| boards                    | FK_boards_workspace                 | FOREIGN KEY (workspace_id) REFERENCES workspaces(id)                   | NO ACTION |
| card_assignees            | FK_card_assignees_assigned_by_id    | FOREIGN KEY (assigned_by_id) REFERENCES users(id)                      | NO ACTION |
| card_assignees            | FK_card_assignees_user_id           | FOREIGN KEY (user_id) REFERENCES users(id)                             | NO ACTION |
| cards                     | FK_cards_board_id                   | FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE         | CASCADE   |
| cards                     | FK_cards_created_by_id              | FOREIGN KEY (created_by_id) REFERENCES users(id)                       | NO ACTION |
| comments                  | FK_comments_author_id               | FOREIGN KEY (author_id) REFERENCES users(id)                           | NO ACTION |
| email_verification_tokens | FK_email_verification_user          | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE           | CASCADE   |
| google_identities         | FK_google_identity_user             | FOREIGN KEY (user_id) REFERENCES users(id)                             | NO ACTION |
| password_reset_tokens     | FK_password_reset_user              | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE           | CASCADE   |
| user_preferences          | FK_user_preferences_user            | FOREIGN KEY (user_id) REFERENCES users(id)                             | NO ACTION |
| welcome_email_deliveries  | FK_welcome_email_user               | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE           | CASCADE   |
| workspace_activities      | FK_workspace_activities_actor       | FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL         | SET NULL  |
| workspace_activities      | FK_workspace_activities_board       | FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE         | CASCADE   |
| workspace_activities      | FK_workspace_activities_workspace   | FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE | CASCADE   |
| workspace_invitations     | FK_workspace_invitations_inviter    | FOREIGN KEY (invited_by_id) REFERENCES users(id)                       | NO ACTION |
| workspace_invitations     | FK_workspace_invitations_workspace  | FOREIGN KEY (workspace_id) REFERENCES workspaces(id)                   | NO ACTION |
| workspace_members         | FK_workspace_members_user           | FOREIGN KEY (user_id) REFERENCES users(id)                             | NO ACTION |
| workspace_members         | FK_workspace_members_workspace      | FOREIGN KEY (workspace_id) REFERENCES workspaces(id)                   | NO ACTION |
| workspaces                | FK_workspaces_creator               | FOREIGN KEY (created_by_id) REFERENCES users(id)                       | NO ACTION |
