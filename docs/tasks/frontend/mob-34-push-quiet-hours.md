# MOB-34 — Server-enforced Push Quiet Hours

Scope: [issue #310 / FINAL Gate D-07](https://github.com/duongkienvn/SE2026-T13/issues/310).

**Status: implementation and focused automated verification complete (CODE COMPLETE). FULL E2E VERIFIED: NO.** Real PostgreSQL execution, provider/device delivery and native visual/accessibility QA are **NOT VERIFIED**. No push, PR, merge, deployment, production flag change, native/APK build or live EPS/FCM/APNs traffic performed.

## Baseline, sources and scope

- Initial working tree clean on `main`, `953845ea`; fetched origin and confirmed current, then created `feat/mobile-push-quiet-hours` in the existing checkout. MOB-33 PR #309 and MOB-32 PR #307 merge commits present. Issue's older dependency paragraph saying #309 is under review is stale; merged source is authoritative.
- Read issue/FINAL D-07, AGENTS/workflow, roadmap P5, Mobile Architecture, Design Spec §4.6/network guide, account timezone/reminder scheduler, notification authorization/preferences/shared contracts, merged Push implementation/tests. AGENTS routing table used; no separate repository workflow router found.
- Loaded `kanvexa-feature`, `kanvexa-verification`, `ponytail`, `appllama-app-design-skill`, `appllama-usage`, `kanvexa-ui`, `impeccable`. Impeccable context ran once: existing visual system; scoped extension allowed, no PRODUCT/DESIGN file or redesign. Appllama MCP unavailable; no invented external screen research. Craft-floor/native-controls guidance applied to incumbent tokens, native Switch/picker, navigation, themes and accessible state copy.
- Directly viewed [approved reference](../../mobile/assets/06-inbox-and-preferences.png) and compared with MOB-32 current screen and §4.6. Existing nine preference leaves, Save/Cancel, Push registry/provider and surrounding Inbox remain intact. No new queue/provider/global scheduler, device timer, weekly schedule, digest or other Phase 5/6 work.

## REST / DTO contract

Authenticated existing `/api`, JwtAuthGuard/current-user session, standard success/error envelopes, response allowlist, existing HTTP throttler, no-store:

| Operation                       | Contract                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET `/users/me/push-schedule`   | 200 `{enabled,startLocal,endLocal,timeZone}`; missing row = false, 22:00, 07:00, account timezone/UTC; **no writes** |
| PATCH `/users/me/push-schedule` | Nonempty sparse `{enabled?,startLocal?,endLocal?}`; authoritative full 200; only changed leaves submitted by Mobile  |

Exact five-character `HH:mm`, quarter-hour steps 00:00–23:45; no whitespace/seconds/trailing newline, null, string boolean, unknown key, timezone or userId accepted. Validate merged pair: equality allowed while disabled, forbidden when enabled; overnight and every nonzero duration including 23h45 accepted. Both clocks can change atomically. Default/no-op PATCH creates no row or timestamp churn.

`timeZone` comes only from existing `user_preferences.time_zone`, UTC fallback, updated only through existing account preferences endpoint. No stored timezone copy, no second timezone control. PATCH resolves zone under User lock and returns it with schedule. Existing notification-preferences and push-preferences schemas unchanged. GET uses ordinary independent reads, not a multi-resource snapshot; concurrent writes can be reflected on the next refresh, while dispatch always rechecks under lock.

## Persistence / migration / cleanup

- `PushQuietHours1794873600000`: only `user_push_schedules`, UUID User PK/unique FK CASCADE, enabled default false, five-character clocks/defaults, quarter-hour/nonzero-enabled CHECK constraints, timestamps. No backfill, push enablement or index/other schema change.
- TypeORM existing discovery loads entity/migration; synchronize/migrationsRun remain false. API module registration additive.
- Soft account-private-state erasure explicitly deletes schedule; physical User deletion cascades. No collaborative object removed by this change.
- Forward-only recovery: disable Push/roll back application while retaining table, then reviewed forward fix. Never run down or production migration as test.

## IANA / DST semantics

Pure `isQuietAt(instant,timeZone,startLocal,endLocal)` and `nextAllowedInstant(...)` receive explicit UTC Date. Intl `formatToParts` with h23 projects named account zone. No server/device timezone, offset assumption or English date parsing.

- Start inclusive; end exclusive. Same-day `start <= wall < end`; overnight `wall >= start || wall < end`.
- Scan real UTC minutes chronologically to first non-quiet instant; do not assume a 24h local day. Both fallback occurrences inside quiet interval suppressed. A non-quiet part between fold occurrences is permitted, and any later repeated quiet minute is guarded anew.
- Spring gaps resolve to first existing non-quiet minute (if intended end is nonexistent), never send while projected time remains quiet. Includes non-hour transitions (Lord Howe). Near-full-day intervals supported.
- Already allowed instant returned unchanged; invalid zone/interval fails closed. Bounded three-day search covers modern named-zone date-line/DST transitions. Cost is linear in deferred minutes (normally <=1500); no new global cache/service.
- Account zone changes affect next worker decision without rewriting saved clock strings or due instants.

## Worker eligibility / locking / outbox semantics

Reuses MOB-33 account Push opt-in, encrypted registry/session/device ownership, transactional enqueue, generic provider payload, lease/SKIP LOCKED, duplicate guards, ACL/recipient/category/resource checks, ticket/receipt polling, retry/backoff/rate limits and UNKNOWN handling. Registry/enqueuer/provider code untouched.

1. Existing claim selects one due PENDING/TICKET job and commits lease before domain locks.
2. Prepare preserves Board → Workspace grant → User (`FOR NO KEY UPDATE`) → device → job order. Schedule PATCH uses User → schedule only; existing account timezone writes lock User (`FOR UPDATE`). No reverse job acquisition on schedule update.
3. After ordinary eligibility and **after receipt branch**, read current schedule + account zone; inject database `clock_timestamp()` into pure helper. Quiet suppresses **new sends only**, not receipt reconciliation.
4. Return same job to PENDING with `next_attempt_at` first allowed instant, `QUIET_HOURS`, cleared lease. No notification/enqueue/digest or attempts increment, no expiry extension. Allowed instant at/after original expiry becomes terminal CANCELLED/EXPIRED immediately; ordinary maintenance also expires waiting jobs.
5. Claim may wake quiet-deferred PENDING before stored next attempt if schedule is off or current saved interval/zone is now non-quiet. PostgreSQL wall projection is candidate selection only; locked Intl check is authoritative. Still-quiet rows do not claim repeatedly, no tight loop or mass job rewrite on PATCH. Query/locking behavior needs real PostgreSQL execution before release.
6. Every send/retry rechecks authoritative opt-in/device/ACL/session; deleted/expired/revoked/inaccessible/archived resources still block. Receipt rejection may retry only via the same send-time guard; uncertain accepted sends retain MOB-33 UNKNOWN behavior.

HTTPS remains outside domain transactions. Schedule commits serialize **future prepare decisions**. A committed send attempt already crossing preparation→HTTPS (including an in-flight request) cannot be recalled. This small external boundary is not atomic with PostgreSQL, and scheduling does not retract alerts queued/delivered by Expo/OS before it. Do not describe this as provider recall. Pending jobs/restart state remain database-owned.

Inbox creation/read counts, Socket.IO events, due-reminder scanner, security/account emails and task email dispatch are unchanged. Payload still `Kanvexa` / `You have a new notification` + opaque notification ID, no schedule/timezone/token/card data added.

## Native UI / draft safety / comparison

- Native `/push-schedule` drill-in immediately beneath existing Push controls. Parent entry disabled for dirty/pending nine-leaf draft (Save/Cancel first), so a stack push cannot silently abandon those edits. Route allowlist/private stack updated, no Inbox changes.
- Uses existing Surface, PreferenceSwitch, ListRow, Button, BottomSheet, ScreenHeader, UnsavedChangesPrompt, `useDraftNavigation`, semantic palettes/spacing/type. Keeps reference settings hierarchy, back/title, grouped controls and schedule affordance; does not reproduce unsupported categories from mockup or redesign settings.
- Default OFF, 22:00/07:00 from server; two native datetimepicker quarter-hour spinners. Fixed UTC **digit carrier** 2000-01-01 + UTC extraction: this is not a real account instant or device-local conversion. Android dismissal/unmount/late callback protections; iOS theme follows app palette. Native errors/ignored minute steps use exact 96-choice accessible sheet, reject rather than round. No dependency added.
- Read-only selectable account IANA zone, explicit overnight note, exact required explanation: “New push alerts are held until quiet hours end, if they have not expired. Notifications still appear in Inbox.”
- Push OFF/server unavailable does not block configuration; honest not-currently-active note. Expo Go copy states remote Push unavailable while backend configuration still works. No permission prompt/automatic opt-in.
- Session/generation-scoped `me` query key; no Board aggregate fence contamination. Strict decoder and sparse adapter. Command fencing/cooldown/ambiguous-write handling and hook lifecycle adapted from MOB-32 without refactoring its implementation.
- Concurrent Save single-flight, no write retries. Full validated PATCH ACK confirms Save, fences older/during-save GETs. Dirty rebase retains local intent, adopts untouched leaves/current zone, requires explicit review. Foreground/reconnect/query recovery respects draft.
- Timeout/network/5xx/invalid ACK retains draft and conservative write lock; GET alone cannot prove previous PATCH settlement. This inherited runtime safety limitation persists across remount/account return; app restart loses the in-memory uncertainty marker. No operation-status/revision contract exists, and none was invented in MOB-34.
- Session/account switch removes old form; late callbacks/results cannot populate new account. Save/Cancel and native navigation removal/warm links use existing unsaved guard.
- Scrollable/flexible wrapping layout, no fixed-height text, existing 48dp targets/keyboard-focus primitives, 320dp+fontScale 2 light/dark/system render checks. **Actual native layout screenshots, font clipping, keyboard navigation, VoiceOver/TalkBack and hardware Back are NOT VERIFIED**; mocked stack tests are not real-device evidence.

## Executed focused verification

Node v24.22.3 / pnpm 10.18.3. Commands from root unless stated. No Web frontend/root suites run. Failed iterative checks were corrected and rerun: permissive shared boolean decorator avoided only in MOB-34 DTO, test mock types/native picker mock fixed, unused mock/import lint fixed. No outstanding code/test failure. One dynamic PowerShell→pnpm Prettier invocation joined filenames into one argument (exit 2); rerun with explicit paths below.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Actual result                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/shared build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | PASS                                                                                                                                                                                          |
| `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath test/push/push-schedule-time.spec.ts test/push/push-schedule.spec.ts test/push/push-schedule.e2e-spec.ts test/push/push-schedule-dispatcher.spec.ts test/push/push-schedule-persistence.spec.ts test/push/push-dispatcher.spec.ts test/push/push-enqueuer.spec.ts test/push/push-worker.spec.ts test/push/push-security.spec.ts test/push/push-registry.spec.ts test/push/push.e2e-spec.ts test/push/expo-push.provider.spec.ts` | PASS **12 suites / 92 tests**; new schedule + inherited Push regression, fake provider only                                                                                                   |
| `pnpm --filter @kanban/backend build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | PASS                                                                                                                                                                                          |
| `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath test/push/push-schedule-time.spec.ts test/push/push-schedule.e2e-spec.ts`                                                                                                                                                                                                                                                                                                                                                        | PASS **2 suites / 34 tests** after final exact-clock/newline check                                                                                                                            |
| `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test apps/mobile/test/push/schedule.test.ts`                                                                                                                                                                                                                                                                                                                                                                         | PASS **10 tests**; full decoder/96 clocks, sparse API, draft/zone, concurrency, 400/429/401/offline/5xx/network, stale ACK/GET/session fences                                                 |
| In `apps/mobile`: `pnpm exec jest --runInBand --runTestsByPath test/push-schedule.component.test.js test/push/time-selector.component.test.js test/push-schedule-navigation.component.test.js test/preferences.component.test.js test/preferences-navigation.component.test.js`                                                                                                                                                                                                                        | PASS **5 suites / 32 tests**; schedule UI, native picker wiring/fallback, timeout, OFF/Expo Go, 320dp/XL themes, account switch, real Expo Router stack guards and existing MOB-32 regression |
| `pnpm --filter @kanban/mobile lint` / `pnpm --filter @kanban/mobile typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                         | PASS                                                                                                                                                                                          |
| Focused `pnpm exec eslint` on every changed backend/shared source, migration and schedule tests                                                                                                                                                                                                                                                                                                                                                                                                        | PASS                                                                                                                                                                                          |
| `pnpm --filter @kanban/mobile bundle:android`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PASS final Android Metro/Hermes export **1669 modules / 1616 native sources**, shared ESM/approved logo verification; **not APK/EAS/native build**                                            |
| `node --check apps/backend/test/push/push-schedule.integration.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                    | PASS syntax only, not execution                                                                                                                                                               |
| Changed-file `pnpm exec prettier --check` with explicit paths; `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                      | PASS explicit changed-source/test paths; final docs formatting PASS; `git diff --check` PASS                                                                                                  |

### Database/provider/device limitations

No process DATABASE/PUSH_DATABASE_TESTS test target designated. Existing Docker application containers are not permission to use their DB or read credentials. No infrastructure/credentials provisioned, no application/production DB used, no migration executed in this session.

Prepared [isolated PostgreSQL fixture](../../../apps/backend/test/push/push-schedule.integration.mjs) requires explicit `PUSH_DATABASE_TESTS=local-only`, loopback host, nonproduction and test/integration-named admin database; creates/drops only a verified random owned database. Uses real migration/services/worker with fake EPS. Covers upgrade/default no-write/CHECKs/concurrent sparse PATCH/two workers/quiet defer/OFF wake/Inbox/TTL/receipt/expiry/late schedule lock/account zone change/soft cleanup/FK cascade. **Execution NOT VERIFIED**; syntax/lint and repository mocks are not transaction/locking E2E proof.

For authorized local test environment, build backend then run `node apps/backend/test/push/push-schedule.integration.mjs` from root with explicit process DB configuration (do not auto-load production `.env`). Credentials/DB provisioning and actual run remain owner-controlled.

Remote FCM/APNs/EPS acceptance, OS DND/queueing, actual native lifecycle/background/terminated/device delivery, multi-device account timing and provider receipt behavior: **NOT VERIFIED**. No real push, APK, EAS Build, install/download, ADB or phone requested/performed.

## Acceptance reconciliation

| Issue matrix                                                      | Evidence / disposition                                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Defaults, synchronized account storage, no cross-user data        | Service/HTTP/session adapter + component races PASS; actual DB/device sync NOT VERIFIED                                      |
| Both interval forms, 15 minutes, sparse/strict contract, near 24h | Pure helpers/DTO/HTTP/model tests PASS                                                                                       |
| Server enforcement independent of app process                     | Worker DB-owned path + fake provider zero-send PASS; real two-worker/restart DB execution NOT VERIFIED                       |
| Inbox/socket/email/reminders independent                          | No source changes to these flows; transactional enqueue/inherited Push regressions PASS, full cross-channel E2E NOT VERIFIED |
| Defer/expiry/no duplicate/no loop/receipts                        | Fake worker tests + unchanged lease/idempotency path PASS; SQL fixture prepared, DB proof NOT VERIFIED                       |
| IANA UTC±/DST/gap/fold/zone changes/toggles/outage                | Pure/worker/API tests PASS; PG/Intl timezone database alignment and real concurrency NOT VERIFIED                            |
| Push OFF/session/device/account/ACL safety/privacy                | Inherited and added fake regression PASS; live provider/device cases NOT VERIFIED                                            |
| Offline/401/429/500/timeout/dirty Back/duplicate Save/A→B         | Mobile component/adapter/stack tests PASS                                                                                    |
| Small/font/themes/accessibility/hardware Back                     | 320dp/fontScale 2 render and stack guards PASS; device visual/assistive/hardware checks NOT VERIFIED                         |

## Rollout / handoff

1. Owner reviews diff/forward-only migration and authorizes an isolated PostgreSQL target; execute fixture and assess real locking/query plan/tzdata compatibility before release. Existing outbox ready index retained; early-wake predicate adds account lookups, so monitor large deferred backlog query cost.
2. Schedule storage/API work while `PUSH_NOTIFICATIONS_ENABLED=false`; do **not** enable production Push automatically. Worker/enqueue remain under existing MOB-33 flag, schedule default OFF. Ensure migration precedes worker/API rollout; old server 404 renders unavailable, never fake local-only scheduling.
3. Review conservative timeout recovery and documented external prepare/HTTPS boundary. No guaranteed immediate delivery; existing provider TTL/job expiry/rate limits apply, no backfill or catch-up digest.
4. Separately authorize native/provider/device verification, visual/accessibility screenshots, actual Android Back and cross-device settings sync. Do not treat JS bundle/unit tests as FULL E2E.
5. No push/PR/merge/deploy until owner permits. Future PR should cite #310 and this evidence/limitations, obtain CI/review. Production migration backup/recovery and credentials belong to operator workflow.

## Local commits

- `aefe6026 feat(push): define IANA quiet-hours contract and interval engine`
- `3529a838 feat(push): persist authenticated account quiet-hours schedules`
- `d0171951 feat(push): defer unsent jobs during server quiet hours`
- `d99ee02f feat(mobile): add session-fenced push schedule editing commands`
- `39693c10 feat(mobile): add native quiet-hours editor and draft guards`
- `f34444d5 test(push): cover quiet-hour erasure retries and isolated database races`
- `fa1492eb fix(push): harden exact clocks native lifecycle and acceptance fixtures`
- Documentation handoff commit recorded in Git history; all local only.
