# MOB-12 — Native Workspace management

[Issue #260](https://github.com/duongkienvn/SE2026-T13/issues/260) extends
MOB-11's selector and authorized Workspace route. This record describes the
implementation and its verification; it is not a deployment record.

## API and state

The mobile adapter uses the existing session-bound transport and Workspace DTO
decoder. Creation posts `name`, `description`, and `icon`; editing sends only
changed fields, including `null` for an explicit clear. Leave and delete consume
204 responses; delete supplies the exact `confirmationName`. No client assigns
Workspace type, creator, role, or policy. The Overview uses the existing
authorized counts and recent Board data; it does not derive member counts from
the directory or fetch each Board individually.

Selection remains owned by MOB-11. Creation refreshes the joined directory before
selecting the server-returned ID. An uncertain creation result disables another
submission across screen remounts for the current session. The user may explicitly
allow a retry after a duplicate warning and checking the list. The fence is not
persisted across app restart or session end.
When creation returned 201 but directory reload failed, a lookup retry uses the
returned ID without sending a second create request.
Leave/delete use MOB-11's Workspace eviction boundary; independent Board grants
are not explicitly removed. A successful response evicts access even if the screen
has lost focus, but only navigates to Boards while that screen is still active. The existing session and resource guards fence late
responses. An uncertain lifecycle result hides protected Workspace details until
an authoritative access check succeeds; a 404 evicts them. Retry-After is observed
for rate-limited mutation attempts.
An edit draft survives a 403 while membership is rechecked and can be reopened
if admin access is confirmed; it is cleared on confirmed downgrade or access loss.

## Known contract discrepancy

Overview Board counts include only Boards readable by the actor. The deletion
service checks _all_ Workspace Boards, including archived and private Boards.
Consequently a zero visible count does not establish that the Workspace is empty.
The owner chose to allow a deletion attempt when the visible count is zero; the
server remains authoritative and returns 409 on a hidden blocker. This is an
explicit exception to the issue's stronger requirement to never offer deletion
for any nonempty Workspace. It does not authorize a new endpoint or disclosure
of protected Board information.

## Changed files

- `apps/mobile/src/features/workspaces/api.ts`, `queries.ts`, and `status.ts`:
  lifecycle requests, shared access eviction and error/retry handling.
- `BoardsScreen.tsx`, `WorkspaceSelector.tsx`, `WorkspaceForm.tsx`, and
  `WorkspaceOverviewScreen.tsx`: selector entry, forms, overview and actions.
- `WorkspaceGlyph.tsx` and `apps/mobile/assets/workspace-icons/`: theme-tinted
  1x/2x/3x PNGs derived from the existing Web Workspace glyph paths in
  `apps/frontend/src/components/icons.tsx`.
- `apps/mobile/test/workspace-discovery.component.test.js`,
  `apps/mobile/test/responsive-row.component.test.js` and
  `apps/mobile/test/workspaces/integration.test.ts`: component, race, narrow-screen
  interaction and REST request coverage.
- `docs/tasks/README.md` and this record: index and MOB-13 handoff.

The local Git history records the implementation commits. No deployment is
implied by those commits.

## Verification and handoff

- `pnpm --filter @kanban/mobile exec jest --runInBand test/workspace-discovery.component.test.js`
  passed 47 tests, including the accessible label for an archived, read-only
  recent Board, Overview refetch on reopening or regaining focus
  within the cache stale window, a late create response after Boards unmounted, late leave and
  delete responses after focus changed, creation from
  the empty directory, active and archived visible-Board deletion blockers, the create
  fence account switch and a draft retained after a 403 with admin reconfirmation.
  An earlier cold run timed out in one
  existing test; that case passed alone and in the full rerun. Coverage includes
  creation, nullable PATCH, remote rename, 403/404 and uncertain lifecycle
  results, 409 leave, exact-name delete, Android Back draft guard, account switch,
  role visibility and Retry-After.
- `pnpm test:mobile` passed 229 Node tests and 170 Jest tests before the later
  archived-Board accessibility label change, including the focus-regain test and the
  lifecycle mutation error matrix for HTTP 400/401/403/404/409/429/503,
  protection against automatic replay, and draft retention on edit errors 400,
  409 and 503. The three new edit-error cases also passed in a focused run.
- `pnpm --filter @kanban/mobile test:realtime:local` passed using a loopback
  Nest server and repository doubles: two native controllers converged after a
  REST edit, presence was deduplicated, and background resume recovered a missed
  change. It did not exercise Workspace Overview or PostgreSQL. Existing mobile
  integration tests separately cover Workspace revocation and removal of an
  unauthorized Board preview from Overview on an access-revoked hint.
- `pnpm --filter @kanban/mobile exec jest --runInBand test/responsive-row.component.test.js`
  passed 2 tests, including Workspace form input, icon selection and submission
  with mocked 320 dp dimensions and font scale 1.6. The renderer does not measure
  native layout, so this is not evidence of visual fit or clipping.
- `pnpm --filter @kanban/mobile bundle:android` passed Metro export and the
  native bundle audit after the Overview refresh change. This does not update
  the earlier EAS APK or constitute a device test of the later changes.
- `pnpm --filter @kanban/mobile bundle:ios` passed Metro export and the native
  bundle audit before the later archived-Board accessibility label change. It is
  not an iOS runtime test.
- `EXPO_NO_DOTENV=1 pnpm --filter @kanban/mobile bundle:development` also
  passed the development export and bundle audit with the loopback test API
  configured before the later create unmount guard. This static bundle was
  subsequently loaded by the installed debug client through a temporary local
  server for the targeted 320 dp device check described below. A later development
  export with the refresh and unmount guards was used for the device refresh check.
  These static bundles are not running Metro servers.
- `pnpm --filter @kanban/mobile typecheck` and mobile lint passed after a frozen install using
  the store recorded in `node_modules/.modules.yaml` restored the already
  declared Google Sign-In package and after the latest implementation changes.
- Root `pnpm lint` passed after the leave/delete focus guard. Changed-file Prettier checks and `git diff --check`
  passed. Root `pnpm format:check` completed with exit 1, reporting 2,874 files
  including pre-existing `.worktrees/` and other files; no unrelated files were
  reformatted.
- Root `pnpm build` passed before the Overview refresh change, including the Android
  Metro export and native bundle audit, after the frozen install restored the
  declared Google Sign-In package. The sandboxed root `pnpm test` was interrupted after Web
  timeouts and backend loopback connections failed with `EACCES`. A second run
  with loopback access completed with exit 1: frontend reported 31 failed files
  and 52 failed tests, and backend Socket.IO E2E processes timed out. These
  failures were observed while workspace packages ran in parallel; their cause
  has not been established. A separate run of `CalendarBoard.test.tsx` passed
  8/8, including the two cases that timed out in the root run; this does not
  establish the outcome of the other failures. A sequential package run with
  loopback access passed all 116 backend suites (1,283 tests), including the two
  previously timed-out Socket.IO suites, but frontend still failed 27 of 1,677
  tests across 20 files and stopped before mobile. A separate run of the affected
  Workspace API integration file passed 12/12. A subsequent
  `pnpm --filter @kanban/frontend exec vitest run --maxWorkers=2` with loopback
  access passed all 158 files and 1,677 tests; this is a reduced-concurrency
  regression result, not a pass for the earlier default root command.
- An isolated PostgreSQL/HTTP lifecycle check passed on a new
  `postgres:16.15-alpine3.24` container bound to loopback. It ran the complete
  migration set and exercised Team creation, nullable PATCH, Overview counts,
  last-admin leave 409, exact-name deletion, nonempty deletion 409, member leave
  and retained explicit Board access. The container was removed after the run.
  This verifies the backend contract, not the mobile app on a device.
- `pnpm --filter @kanban/backend test:workspace-api:database` failed before its
  lifecycle assertions: the historical migration filter skips AccountDeletion
  while StarterBoardOnboarding requires the skipped
  `require_live_account_reference` function. It used a separate disposable
  loopback container, which was removed. Backend test code was not modified.
- The owner authorized an EAS internal debug build after local Gradle failed.
  [Build 43df3ba3](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/43df3ba3-c8f7-443c-98a3-3d453d8e3276)
  passed and produced `apps/mobile/apk/kanvexa-mob12-debug.apk` (SHA-256
  `81a3e07849e955f94aeac7dbaced5e42d315a31487f416302c2776ee09fc6412`).
  The temporary build copy used application ID `tech.kanvexa.mobile.dev.mob12qa`,
  a debug Gradle variant and loopback API configuration. It requires the local
  Metro server and is not a standalone release APK; the existing application on
  the phone was not overwritten. The initial device run predates the later
  focus guard for a successful leave or delete response; that guard has component
  coverage and has not been separately exercised on the device.
- On a Samsung SM-A507FN (Android 11), using only a disposable PostgreSQL database
  and a local API via ADB reverse, device checks passed for empty-name validation,
  Team creation and selection, actual Overview counts and icon, clearing the
  description to database NULL, last-admin leave rejection, exact-name delete
  confirmation, successful deletion and fallback to Personal Workspace, and the
  Android Back unsaved-changes prompt. Dark mode was active. Evidence images are
  `apps/mobile/apk/mob12-last-admin-device.png` and
  `apps/mobile/apk/mob12-delete-device.png` (ignored build artifacts).
- On the same Android device, a later run loaded the current development bundle
  through a temporary loopback server and exercised the create form at 320 dp,
  font scale 1.3 and dark mode. Name entry, keyboard dismissal, scrolling to
  Cancel and Create, creation, and the resulting Overview worked with the local
  test API. `apps/mobile/apk/mob12-320-form.png` records the form. The screenshot
  was visually inspected. The original density and font scale were restored,
  test-only app data was cleared and the disposable database removed. This is
  targeted coverage, not full visual, screen-reader or motion validation. This
  run predates the subsequent create-response unmount guard.
- A separate Android device run used two local test accounts and a disposable
  database. A Workspace MEMBER saw no edit or delete action, saw the leave action,
  and successfully left; the app selected Personal Workspace and the test database
  confirmed membership removal. `apps/mobile/apk/mob12-member-device.png` records
  the MEMBER Overview. This run used the development bundle from before the create
  unmount guard; it did not exercise that guard.
- Another Android run used an admin and a Workspace with one visible Board.
  The Overview displayed its active count and blocked Workspace deletion. After
  archiving the Board through the test API and refreshing, it displayed one
  archived Board, read-only status and the same deletion blocker. The first
  immediate revisit showed cached counts; the test did not capture socket
  connection or delivery evidence, so its cause and realtime synchronization
  remain unverified. The static server served the bundle while the app's socket
  configuration targets the separate local API origin. The existing backend
  publishes Board archive/restore events only to sockets with that Board's
  receive grant, and Workspace Overview does not join every Board room. Therefore
  an open Overview is not guaranteed an immediate Board event; the scoped REST
  refetch on reopening does not claim to provide live updates while it remains open.
  Adding a Workspace-wide event or changing Board subscriptions is outside this
  task's approved API and realtime-contract scope. The owner accepted this
  limitation for MOB-12 delivery.
  `apps/mobile/apk/mob12-board-archived-device.png` records the archived state.
  A subsequent device run used two Workspace admins and a private Board hidden
  from the second admin. Overview showed zero visible Boards and allowed a delete
  attempt; the server returned 409, the app showed the empty-Workspace error
  without revealing the Board, and the database confirmed the Workspace remained.
  `apps/mobile/apk/mob12-hidden-board-device.png` records the error. No production
  data was used.
  iOS navigation, keyboard, accessibility and device behavior were not tested;
  this Windows environment has no iOS simulator or connected iOS device.
- The approved mobile reference was inspected directly. Appllama tools were not
  available in this session, so external reference-screen research and the
  simulator/motion review required by the native design guidance are not verified.
- MOB-13 should continue using `useSelectedWorkspace` and the existing Workspace
  and Board query factories; this task does not implement Board Directory,
  Board creation, membership, invitations or policies.

## Delivery limitations

- The repository-wide `format:check`, default root test command and Workspace
  database script failed as described above. The successful reduced-concurrency,
  per-package and isolated PostgreSQL runs do not turn those commands into passes.
- The owner requested delivery without further accessibility, motion and iOS
  verification. The 320 dp create-form check above is targeted and does not
  establish the remaining untested device scenarios.
- The EAS artifact is a debug client requiring Metro, and its isolated application
  ID and loopback configuration are test-only. The existing app was not replaced.
  Keep the user-approved hidden-Board deletion behavior and the in-memory create
  fence limitation visible during final review.
