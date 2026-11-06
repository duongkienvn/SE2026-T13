# Starter Board onboarding

Scope: DX-03 onboarding guidance, with AC-01 account deletion compatibility.
Only genuinely new local/Google accounts enroll. Existing accounts are not
backfilled. Sample data uses existing Board/Card entities and normal views.

The registration transaction owns account, Personal Workspace and template v1
creation. A User row lock and one durable enrollment per User serialize retries.
The Board reference becomes null after removal; this tombstone prevents reseeding.
There is no startup migration, public provisioning endpoint or reconciliation seed.

Removal is restricted to the original user as current sole Board OWNER in their
Personal Workspace, with PRIVATE visibility and no collaborative history/data.
An owner-only preview returns a persisted graph digest. Removal rechecks it under
the existing Board lock. The exact phrase is `REMOVE SAMPLE BOARD` for pristine
data and `DELETE MY CUSTOMIZED BOARD` after any detected change. Stale previews
must be refreshed. File deletion reuses existing durable attachment cleanup
triggers; no provider calls occur inside transactions.

Migration adds only `starter_board_provisions`; no existing rows change. Empty
rollback is supported; rollback after enrollment refuses to discard provenance.
Account deletion explicitly erases this private enrollment after normal blockers
are resolved. Operational rollout requires the ordinary explicit migration step.

## Template v1 inventory

`Welcome to Kanvexa` is PRIVATE in the registering user's Personal Workspace,
with that user as its sole OWNER and the existing `indigo` background preset.
The requested description is stored verbatim. There are nine real Board labels,
ten checklists, 35 checklist items (12 checked), and five self-assigned Cards.
All descriptions and metadata are ordinary editable business data.

| Column      | Cards                                                                            | Dates (offset from User creation)                     |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Start Here  | Welcome to Kanvexa; Explore Your First Board; Make This Workspace Yours          | Welcome: start +0, due +1 day                         |
| To Do       | Plan Your First Project; Organize Tasks with Labels; Schedule Your Upcoming Work | Project: start +0, due +7; Schedule: start +1, due +3 |
| In Progress | Try a Checklist; Explore Different Board Views                                   | Views: start +2, due +10                              |
| Done        | Your Workspace Is Ready; Discover Kanvexa Features                               | No due dates                                          |

Labels: Getting Started, Tutorial, Board, Tips, Workspace, Planning, High Priority,
In Progress, Completed. High Priority is only a label; Done/In Progress are
Column names, not invented Card workflow states. Selected Cards use partial or
complete checklists to demonstrate actual completion counts. No comments,
attachments, Activity or notifications are fabricated.

Positions reuse `appendPosition` and its exact decimal arithmetic. UTC dates are
creation instants plus whole 24-hour offsets, never hardcoded dates or server-local
midnight. Existing user timezone/date-format preferences govern all rendering.

## Provisioning lifecycle

- `AuthService.register` creates User, calls `ensurePersonalWorkspace`, provisions
  the sample through the same EntityManager, then enrolls welcome mail. Password
  hashing remains before the transaction; verification delivery remains after it.
- `GoogleAuthService.signIn` calls provisioning only in its new-User branch,
  inside its existing identity transaction. Subject/email advisory locking and
  retries remain intact. Existing Google sign-in and account linking do not seed.
- `StarterBoardProvisioningService` requires an active transaction, locks the
  live User, validates their Personal Workspace and checks enrollment before any
  sample writes. PK `user_id` plus unique nullable `board_id` provide durable
  uniqueness. Every child persists through existing TypeORM repositories.
- A failed transaction rolls back account, identity, Workspace, enrollment and
  the entire sample graph. No outbox/Activity/notification producers are called
  by provisioning. Existing verification/welcome behavior is preserved.
- Login, verification retries, Workspace reconciliation, query/list loading and
  reconnects do not invoke provisioning. Neither marker absence on an existing
  user nor a null Board reference requests reseeding. No backfill is performed.

## Identification and removal API

Authorized Board detail includes optional `isStarterBoard`, true only for the
original enrollment user as current OWNER. It comes from provenance, never the
Board name or user-controlled request fields. Ordinary Board creation is unchanged.

`GET /api/boards/:boardId/sample-removal` is authenticated, owner-only and
`Cache-Control: no-store`. It returns:

```json
{
  "boardName": "Welcome to Kanvexa",
  "isCustomized": false,
  "version": "<64 lowercase hex characters>",
  "confirmation": "REMOVE SAMPLE BOARD"
}
```

`DELETE` on the same URL requires exactly `{version, confirmation}` and returns
204 on success. Unknown fields and malformed digests are rejected. The exact,
case-sensitive phrase becomes `DELETE MY CUSTOMIZED BOARD` after customization.
The UI explains that all contained data, including work the user added, is
permanently removed. No generic Board hard-delete endpoint is introduced.

| Outcome                                                           | Response                                |
| ----------------------------------------------------------------- | --------------------------------------- |
| Missing/invalid JWT                                               | Existing 401 handling                   |
| Nonmember/unavailable Board                                       | Existing concealed 404                  |
| Current MEMBER instead of OWNER                                   | 403 FORBIDDEN                           |
| Ordinary Board or another enrollment user                         | 404 STARTER_BOARD_NOT_FOUND             |
| Shared/moved Board, other users' content or collaborative history | 409 STARTER_BOARD_REMOVAL_UNSAFE        |
| Graph changed since review                                        | 409 STARTER_BOARD_CHANGED; review again |
| Incorrect confirmation phrase                                     | 400 VALIDATION_FAILED                   |

Eligibility requires PRIVATE visibility, the original user's Personal Workspace,
and no additional Board members, other authors/assignees/uploaders/mentioned users,
other recipients, membership Activity or Workspace move history. These conditions
are deliberately conservative, including soft-deleted comments and prior
collaboration. Shared ownership/content is never silently discarded. Converted
collaborative boards continue using ordinary ownership/Workspace management.
Archived sample Boards can still be removed by their OWNER; archiving alone does
not satisfy the existing account-deletion checks.

The persisted graph digest includes Board fields, Columns, Cards, labels/links,
assignees, lists/items, comments/mentions, attachments, Activity and Workspace
Activity. It includes persisted timestamps and IDs, so editing/reverting content
normally still triggers the stronger confirmation. Star/view state and derived
due status are excluded. No graph contents or storage keys are returned by review.

Review and deletion acquire the normal Board row lock; deletion also checks the
Workspace under a read lock. Existing Board mutations share that boundary. A
fresh digest is compared before writes, so competing edits require renewed
confirmation. The UI keeps a reviewed snapshot immutable and clears confirmation
on retry; background invalidation cannot silently replace the approved snapshot.

Only eligible owner-authored Activity is explicitly removed to respect its
restrictive FK. Cards are deleted before Columns because their Column FK is
RESTRICT; all other cleanup uses existing CASCADE/SET NULL constraints. Enrollment
survives with a null Board reference. Existing attachment triggers preserve/rearm
both object-key cleanup tombstones, including pending uploads and their existing
expiry plus grace period. Physical deletion is asynchronous and requires the
existing cleanup worker/storage configuration; no provider call occurs in the
transaction and no files are fabricated for onboarding.

Deletion uses the Board room coordination boundary, then revokes receive grants
and notifies access changes after commit. Delivery failure cannot change the
committed REST result. The frontend uses session fencing and existing Board
revocation/cache clearing before returning to Boards. The action/dialog add no
new layouts, CSS, dependencies or sample-only rendering. Calendar/Table, Card
Detail and Workspace Overview consume the normal APIs unchanged.

## Account deletion and operations

Normal `PERSONAL_WORKSPACE_HAS_BOARDS` and last-owner checks are unchanged.
Authorized sample removal clears its references and memberships; a user with no
other blockers can then use the normal reauthenticated account-deletion flow.
`eraseAccountPrivateState` explicitly removes the retained enrollment. The new
table uses the existing live-account DB guard, preventing insertion for tombstones.

Apply `1794700800000-StarterBoardOnboarding.ts` before deploying the new backend;
do not enable startup migrations. It creates only the provenance table, FK/check
constraints, and its live-reference trigger. Existing data is neither updated nor
seeded. A populated down migration refuses to lose provenance; use a reviewed
roll-forward migration after enrollment begins. No development/production database,
AWS account, production user or deployment was touched during this implementation.

## Verification

- PASS: `pnpm --filter @kanban/shared build`.
- PASS: focused backend Jest (`auth.service`, Auth/Google HTTP, welcome onboarding,
  Boards service/DTO, starter template): 120 tests in seven suites.
- PASS: `pnpm --filter @kanban/backend test:starter-board:database`: ten acceptance
  groups on an owned disposable PostgreSQL 16 Docker container. Covers populated
  migration upgrade/empty down-up/zero ORM drift, retained legacy User/Board/Card
  data, complete template and real REST summaries, local/Google concurrency,
  rollback injection, no duplicate/recreated samples, strong/stale confirmations,
  authorization, moved/shared/other-author safety, real row-lock races, FILE cleanup
  tombstones and successful account deletion after removal.
- PASS: `node apps/backend/test/auth/welcome-email.integration.mjs`: 15 PostgreSQL/
  HTTP checks, including existing verification/welcome behavior and mocked provider
  failure handling. The historical migration harness defers the new migration
  until its Account Deletion guard dependency exists.
- PASS: `node apps/backend/test/users/account-deletion.integration.mjs`: 20 real
  PostgreSQL/Nest/Socket.IO groups. The migration test preserves all existing FKs
  while accounting for the new private table. Re-registration now correctly
  expects its own new Starter Board membership rather than zero memberships.
- PASS: five focused removal-dialog tests plus 39 Calendar/Table/Board navigation
  regressions. Tests exercise exact phrases, stale reviews, API payloads and
  hidden actions on unmarked/non-owner Boards.
- PASS: `pnpm lint`, backend build (through database script), frontend build, and
  changed-file Prettier/whitespace checks. Full repository formatting audits and
  unrelated backend/database/export/stress suites were intentionally not run.
- Browser QA: existing isolated DEV fixture extended with `sample=customized`.
  Two screenshots checked the real removal dialog at 1280×800 dark and 375×812
  light. Confirmation started disabled, Cancel received focus, controls fit with
  no page overflow, and Escape restored the Board actions trigger. No browser
  console warnings/errors. No CSS or approved Calendar/Table files changed.

Build retains the pre-existing Vite environment/bundle-size advisories. PostgreSQL
test startup reports the existing pg concurrent-query deprecation warning.
Disposable containers were removed. No production migration or real object-store
deletion was performed; durable cleanup scheduling was verified against PostgreSQL.
