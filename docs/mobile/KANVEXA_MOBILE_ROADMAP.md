# Kanvexa Mobile — Complete Implementation Roadmap

> **Document:** `KANVEXA_MOBILE_ROADMAP.md`\
> **Version:** 1.0 — actionable planning baseline\
> **Prepared:** 2026-11-07\
> **Product:** Kanvexa Mobile (Android + iOS)\
> **Repository:** [`duongkienvn/SE2026-T13`](https://github.com/duongkienvn/SE2026-T13)\
> **Companion documents:** [`KANVEXA_MOBILE_DESIGN_SPEC.md`](./KANVEXA_MOBILE_DESIGN_SPEC.md), [`KANVEXA_MOBILE_ARCHITECTURE.md`](./KANVEXA_MOBILE_ARCHITECTURE.md)\
> **State:** Proposed implementation plan; **no GitHub issues, branches, milestones, owners, or dates have been created/assigned**.\
> **Product decision:** **ONE complete mobile app. No separate MVP/Post-MVP plan, release tier, or artificial feature cut.** Phases below organize implementation and verification only.

---

## 0. Read this first — binding decisions

1. **Kanvexa Web defines business-feature parity.** Implement the mature Web system's actual capabilities on mobile; adapt the interaction model for touch. Do not rewrite or fork business logic into a second backend.
2. **Approved mobile images + Design Spec define visual direction.** The ten approved screen groups, authentic Kanvexa K logo, four bottom tabs (Home / My Tasks / Boards / Inbox), light/purple aesthetic, native sheets and full-screen Card Detail are the UI baseline. Follow existing architecture's exception policy for illustrative elements unsupported by server.
3. **Architecture defines engineering constraints.** React Native + Expo + TypeScript in `apps/mobile`; reuse existing NestJS API, Socket.IO and `@kanban/shared` after Metro validation; TanStack Query for authoritative server state and SecureStore for bearer credentials.
4. **No invented product behavior.** A visually attractive mockup is not evidence of a backend field, endpoint, permission, notification category, 2FA implementation, session list or calendar event. Make the smallest explicit owner-reviewed visual adjustment or scoped contract addition needed for a working product.
5. **Do not assign work yet.** Issue codes below are **planning identifiers**, not GitHub issue numbers. No assignee, calendar deadline, velocity estimate or forced parallel ownership is defined; allocation is intentionally deferred.
6. **Protect working Web/production.** No speculative schema changes, deployment edits, DNS changes, production load tests, production credential use, store submission or pushes/PRs without explicit authorization. A mobile issue must not redesign polished Web UI.
7. **Functional completeness is the finish line.** All feature-parity items and release criteria must close before declaring Kanvexa Mobile complete. Completing an early phase does not imply a separate public MVP release.

### 0.1 Sources of truth and precedence

| Priority | Reference                                     | Used for                                                         |
| -------- | --------------------------------------------- | ---------------------------------------------------------------- |
| 1        | Backend source, DTOs, tests, live permissions | Actual API/business invariants, auth, privacy and data integrity |
| 2        | Approved images, official supplied logo       | Approved visual composition, branding and intended interaction   |
| 3        | `KANVEXA_MOBILE_DESIGN_SPEC.md`               | Screen layout, UI components, state patterns, navigation         |
| 4        | Current Kanvexa Web implementation            | Complete feature inventory and correct observable behavior       |
| 5        | `KANVEXA_MOBILE_ARCHITECTURE.md`              | Implementation boundaries, risks, native integration             |
| 6        | This roadmap and its eventual GitHub issues   | Sequencing, deliverables and acceptance tests                    |

If a source contradicts a mockup, use a short **variance record** (`UI-xxx` / `API-xxx`, facts, impact, resolution, owner approval) before silently changing either. An issue is not permission to expand its API scope without review.

### 0.2 Terminology

- **Parity:** behavior equivalent to Web where a feature exists, not necessarily identical screen geometry or gestures.
- **Native-only integration:** device-specific mechanics necessary to make parity usable (SecureStore, file pickers, deep links, app lifecycle, native builds). It does not implicitly create new backend business features.
- **Capability gap:** missing backend support or a mockup-only affordance. Must be logged and decided inside the relevant issue, not hidden by a no-op button.
- **Dependency:** code/contract/test artifact required before an issue can be safely integrated; a team may build unrelated tasks in parallel if dependencies are satisfied.
- **Server-authoritative:** a count, membership, score, position, read state or status is obtained from the actual API and reconciled after mutation; cache/optimism is temporary.
- **Ready:** enough approved inputs, endpoint details and tests exist for Codex to implement without guessing.
- **Done:** tests, security/permission cases, visual comparison, documentation and local commit hygiene are complete; a PR alone is not sufficient.

---

## 1. Baseline and scope inventory

### 1.1 Current implementation context (recheck immediately before each issue)

- pnpm workspace matches `apps/*` and `packages/*`; production Web is `apps/frontend`, server is `apps/backend`, shared package is `packages/shared`.
- Backend is the source for Workspaces, Boards, Columns, Cards, assignments, labels, checklists, comments, URL/private attachments, Home/My Tasks, Search, notifications, account management and exports.
- The Web has Board/Kanban, **Table**, and **Calendar** views. The ten mobile hero designs do not depict every supporting management screen; **Web parity still requires them**.
- Password credentials issue a **fixed-expiry JWT**; the inspected Web flow has **no refresh-token endpoint**. Do not plan silently around a nonexistent refresh token.
- Board/Card filtering and large-Board fetch patterns are being optimized in Web PERF-01 [`#233`](https://github.com/duongkienvn/SE2026-T13/issues/233) and PERF-02 [`#234`](https://github.com/duongkienvn/SE2026-T13/issues/234). Before mobile Board work, use their actual **merged** result or consciously justify the native equivalent.
- Routes observed in the code audit on 2026-11-07 are **source-verified, not guaranteed to be deployed**. Inspect latest default branch, relevant Swagger and server tests before implementation.

### 1.2 Complete feature-parity checklist (not a second backlog)

| Domain                    | Functional scope expected in completed Android/iOS app                                                                                                                               | Roadmap coverage       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Identity                  | Login, registration, email verification/resend, forgot/reset password, Google sign-in, linked Google account, sign out, expired/revoked sessions                                     | MOB-05, 08, 09, 39     |
| Home                      | Counts, Up Next, starred/recent Boards, quick navigation                                                                                                                             | MOB-10                 |
| Workspace                 | Personal/team discovery, create/rename, overview, members/roles, guests, invitations, leave/delete, policies, activity                                                               | MOB-11, 12, 23, 24, 27 |
| Board                     | Discover, create/edit, star, backgrounds, visibility/privacy, move Workspace, lifecycle/archive/restore, member management, permissions, starter-board special removal, Board export | MOB-13, 14, 15, 25, 40 |
| Kanban/Columns            | View + filter, create/edit/order/delete Column, safe horizontal gestures                                                                                                             | MOB-15, 16             |
| Cards                     | CRUD, move/reorder, duplicate, archive/restore, detail, labels, assignees, dates, preview summaries, archived read-only                                                              | MOB-17–19              |
| Rich Card                 | Checklists, comments/mentions, URL attachments, private uploads/downloads                                                                                                            | MOB-20, 21, 26         |
| Views                     | Table, Calendar Month/Week, compatible Board view switch and date/filter semantics                                                                                                   | MOB-22, 35, 36         |
| Collaboration             | Board/Workspace membership, invitations, activities, live presence, safe Socket.IO reconciliation                                                                                    | MOB-06, 23–28          |
| Productivity              | Cross-Board My Tasks, Global Search, Inbox/read/unread/preferences                                                                                                                   | MOB-29–32              |
| Native notification layer | Push and quiet-hours affordances only if built as real, reviewed device/server capabilities                                                                                          | MOB-33, 34             |
| Account settings          | Profile/avatar, email-change (when source-verified), appearance, timezone/date/week preference, password, connected accounts                                                         | MOB-37–39              |
| Privacy & data            | Account export, OWNER Board JSON/CSV export, safe file share/save, account deletion with blockers                                                                                    | MOB-40, 41             |
| Quality & distribution    | Tests, device accessibility, resilience, perf/security, EAS internal/store builds, release gates                                                                                     | MOB-07, 42–47          |

**Scope note:** 2FA, account session inventory, login activity, editable Bio, selectable languages, “Completed” as a server-side My Tasks group, timed meetings in Calendar and Workspace/Board filters in Search are **not established current backend capabilities**. They are handled by **decision gates** in §3 and the affected issue, not silently accepted as already-existing Web features. Likewise, mobile push delivery is native-specific and must be implemented end-to-end before its switch becomes operable.

### 1.3 Global non-goals and exclusions

- No separate mobile-only database, business service, GraphQL rewrite, generic offline sync engine, cross-Board Card migration feature or new task priority domain just because it looks useful in a screenshot.
- No hard-delete Board/Card affordance unless a real authorized Web/API operation exists. Starter/sample removal is a narrowly guarded special case, not general deletion.
- No assumption that Socket.IO is a background push service; no fabricated success notifications or synthetic completed task counts.
- No unreviewed subscription/analytics SDK, advertising/analytics identifiers, public private-file URLs, local storage of private API payloads, or default production endpoint in developer builds.
- No visual redesign of existing Web pages during native development. If a backend bug blocks parity, create a minimal contract/test fix separate from Web presentation.

---

## 2. Phase map and issue catalog

There are **7 implementation phases and 47 proposed issues**. Codes are stable planning keys; GitHub issue numbers can be assigned later. There is no team allocation or fixed schedule.

| Phase                         | Goal                                                                                  | Issue IDs     |  Count | Completion gate                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------- | -----: | ------------------------------------------------------------------------------ |
| **P1 — Foundation**           | Expo workspace, approved UI primitives, navigation, transport, security, realtime, CI | MOB-01–07     |      7 | Android development boot, typed API smoke, auth skeleton and unaffected Web CI |
| **P2 — Identity & Discovery** | Working Auth, Home, Workspace and Board discovery/management                          | MOB-08–14     |      7 | User can sign in and discover/manage permitted Workspaces/Boards               |
| **P3 — Board & Card Core**    | Kanban, full Card management, rich metadata/attachments, Table                        | MOB-15–22     |      8 | Primary Kanban/Card flows work and match Web permissions/data                  |
| **P4 — Collaboration**        | Membership, invitations, comments, activity, presence and multi-user correctness      | MOB-23–28     |      6 | Cross-device realtime and role revocation QA pass                              |
| **P5 — Productivity & Views** | My Tasks, Search, Inbox, native notification handling, Calendar                       | MOB-29–36     |      8 | All productivity views and authorized deep links functional                    |
| **P6 — Settings & Data**      | Profile, preferences, security, exports, privacy, deletion                            | MOB-37–41     |      5 | Every supported account/security/data management flow functional               |
| **P7 — Hardening & Release**  | Parity matrix, security, performance, accessibility, builds, store release            | MOB-42–47     |      6 | Android/iOS release checks pass and owner approves release                     |
| **Total**                     | **Complete Kanvexa Mobile**                                                           | **MOB-01–47** | **47** | **No separate MVP/Post-MVP release**                                           |

> **Sequencing rule:** phase order reflects logical dependencies, not a requirement to finish every issue in a phase before starting a logically independent later issue. Some UI can progress while backend/security integration is in progress. Release cannot skip earlier parity items.

### 2.1 Stable issue fields (to paste into GitHub later)

Every created GitHub issue should include:

```md
# MOB-XX — [Feature]

Phase: P# — [Name]
Type: foundation | UI | integration | backend-additive | QA | release
Priority: Critical | High | Medium (assign only when creating issues)
Owner: TBD (do not assign now)
Dependencies: MOB-.. / explicit external prerequisite
References: Design Spec §..., Architecture §..., verified source paths

## Outcome / user-visible behavior

## In scope / out of scope

## API & security contract

## Implementation steps

## Acceptance criteria (functional, edge, role, native, accessibility)

## Tests / evidence

## Definition of done / handoff
```

**Workflow:** One coherent feature/concern per branch; if the team retains the Kanvexa practice, aim for **7–8 meaningful commits on substantial feature issues**, with real tests/docs (no filler). Avoid forcing commit counts for trivial fixes. Codex must explicitly commit when instructed, keep clean worktree, and must not push/open PR/merge/deploy unless authorized. PR body should be concise; linked issue contains the detailed requirement.

### 2.2 Integration and change-management rules

- For every implementation issue: inspect `AGENTS.md`, current `main`, appropriate Design Spec/Architecture sections, Web feature code/DTOs/tests and any current CI/feature-flag changes. Note baseline commit in the PR handoff, not permanently in this living roadmap.
- Use **contract-first** additions. Where native needs a truly missing endpoint, first document parameters, authorization, index/transaction impact, migration/backfill impact, OpenAPI/DTO/shared type, regression tests and rollout safety. Then implement the smallest compatible addition; never guess names.
- All backend writes remain transactional according to existing services. Existing `401/403/404/409/429` behaviors, archived/read-only rules and private-data protections remain authoritative.
- Protected query caches are isolated by user/session generation and cleared after sign-out, expiry, password invalidation, account switching and access revocation. Optimistic edits must reconcile or roll back.
- Screens must have actual loading/empty/error/offline states. No visually polished screen that only works with static demo data.
- Visual review uses approved image reference(s), true logo and representative device captures (at least one narrow Android and one iPhone-sized reference, plus a small/large-text case). Screenshots are evidence, not a mandate for exhaustive token-expensive capture on every small change.
- Release and Web deployment pipelines are separate. Do not run a native store/cloud build on every Web-only PR unless justified.

---

## 3. Dependency decisions and compatibility gates

These gates are **part of the roadmap**, not a new analysis phase or a second MVP cycle. Each has an owning issue below, a recommended default and an explicit closure condition.

| Gate                             | Source-observed issue                                                               | Default implementation decision                                                                                                                                                         | Resolve in           |
| -------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **D-01 JWT**                     | Existing Web access JWT expires, no refresh flow                                    | Mobile securely stores JWT+expiry and signs out when invalid. No fictional refresh. A refresh-token backend addition requires a separately approved security design.                    | MOB-05, 08, 43       |
| **D-02 native Google**           | Web GIS implementation is browser-only; backend exchanges Google ID tokens          | Use official Android/iOS OAuth clients and verified audience handling, then existing `/auth/google`.                                                                                    | MOB-09               |
| **D-03 Search filters**          | `/api/search` supports `q/type/limit/page`, not `workspaceId/boardId`               | Render only truly supported filters until a minimal ACL-safe additive backend filter is formally approved. Never apply an incomplete client-side slice.                                 | MOB-30               |
| **D-04 Completed tasks**         | `/users/me/tasks` only includes active assigned Cards; no `Completed` group         | Use valid server buckets and record the visual variance; don't fabricate completion. Additive backend extension only with explicit product decision and tests.                          | MOB-29               |
| **D-05 Calendar semantics**      | Existing Calendar groups by due day; `startDate/dueDate` are instants, not meetings | Month and Week show truthful Card deadlines; no invented 10:00–11:30 event durations. Cross-workspace aggregation requires verified authorized API.                                     | MOB-35, 36           |
| **D-06 push**                    | No verified native device-token registry/delivery                                   | Treat **real push delivery** as a native capability issue; either implement server+device path or obtain owner-approved exclusion and adjust the mockup. An inert switch is prohibited. | MOB-33               |
| **D-07 quiet hours**             | No verified quiet-hours preference or scheduler                                     | Real timezone-aware opt-in policy only after approved server contract; otherwise no active control.                                                                                     | MOB-34               |
| **D-08 security mockup gaps**    | No verified 2FA/device session inventory/login activity                             | Show supported password and linked-provider controls; log and approve any visual correction. No fake security actions.                                                                  | MOB-39               |
| **D-09 Bio/language**            | No verified editable Bio or language contract                                       | Do not persist or present speculative fields as functional settings; link timezone to Preferences.                                                                                      | MOB-37, 38           |
| **D-10 private files**           | Authorized uploads involve intent/verification/leases and provider constraints      | Complete exact protocol with native file APIs and cleanup; never bypass it via public S3 links.                                                                                         | MOB-21, 43           |
| **D-11 Web performance changes** | #233/#234 in-flight when architecture was checked                                   | Reassess final merged query/invalidation behavior before Board mobile implementation.                                                                                                   | MOB-04, 06, 15, 44   |
| **D-12 app links**               | Web URLs exist, native association/config is new                                    | Validate HTTPS App/Universal Links, OAuth links and invitation proofs end to end; no client-only auth bypass.                                                                           | MOB-03, 08, 24, 46   |
| **D-13 Board visibility/roles**  | Workspace ADMIN and Board OWNER permissions differ                                  | Never substitute Workspace role for explicit Board OWNER, especially Board export.                                                                                                      | MOB-12–15, 23–25, 40 |
| **D-14 Account lifecycle**       | Account delete and email change have strict reauth/verification                     | Use source-verified body contract and blocked/expired cases, wipe native data on success.                                                                                               | MOB-37, 39, 41       |

### 3.1 Decision/variance record template

For every unresolved gate, add one row in issue comments or `docs/mobile/decisions.md`:

```text
ID: D-XX / UI-XX
Observed: exact current code/API and link
Visual request: approved screenshot / screen section
Options: A (server-compatible UI), B (approved additive backend)
Decision: chosen option + owner acknowledgment + date
Impact: API / tests / native screen / migration / rollout
Status: open | approved | implemented | verified
```

Do **not** silently classify a conditional mockup-only feature as already implemented. The complete product must have a real working feature or an explicitly approved design correction, never a dead CTA.

---

## 4. Phase 1 — Mobile Foundation (MOB-01–07)

**Phase outcome:** `apps/mobile` boots on an Android device/emulator, shares verified contracts, renders the approved native shell and can make a safe local/staging request. Auth/session and socket infrastructure are testable; Web CI/CD remains intact. **These are infrastructure issues, not placeholders standing in for working product screens.**

### MOB-01 — Expo app bootstrap, pnpm/Metro compatibility and native environment

- **Type:** Foundation. **Dependencies:** none. **Design/API anchors:** Architecture §§2–3, 14; root `package.json`, `pnpm-workspace.yaml`, `packages/shared/package.json`, `AGENTS.md`.
- **Outcome:** Add `apps/mobile` as a separate Expo/React Native/TypeScript application, not a fork of Vite/Web or an unrelated repository.
- **Implementation:** Select and pin a mutually compatible Expo SDK, React Native, React, Node, Expo Router, Metro, pnpm and native-module set. Keep package manager at the repository's configured version. Add explicit `dev`, Android, iOS, typecheck and development-bundle scripts, with names reviewed against root `pnpm -r` recursion.
- **Integration:** Prove a **runtime** import (enums/format helper) and **type** import from `@kanban/shared` in Metro. Make only necessary workspace/build tweaks; preserve ESM/CJS exports usable by backend and Web. Document emulator host mapping vs physical phone LAN address; do not commit actual secrets.
- **Acceptance:** App starts on supported Android; no DOM, `window`, browser storage or Node-only module reaches native bundle; brand logo asset is importable; cold start/fast refresh work; no surprising root build/deploy behavior.
- **Tests/evidence:** Version matrix, clean install with lockfile, Metro bundle, Android boot screenshot, shared import proof, root Web/backend/shared lint/test/build regression. iOS build validation is recorded when available, not falsely claimed if no device/credentials.
- **Out of scope:** Auth business flow, feature screens, push, production environment or store release.

### MOB-02 — Native design tokens, typography, logo and reusable component primitives

- **Type:** UI foundation. **Dependencies:** MOB-01. **Design anchors:** Design Spec §§1–3, 5, 7, approved asset pack and genuine Kanvexa K.
- **Outcome:** A consistent reusable component layer for every approved mobile screen, not ten independently styled pages.
- **Implementation:** Establish semantic colors/light/dark/system roles, typography, space/radius/elevation tokens, safe-area handling, responsive text, touch targets and icon sizing. Use the supplied K mark, not the provisional stacked-square icon in earlier mockups. Add a clearly justified styling solution (StyleSheet or tested NativeWind) and document its rationale.
- **Components:** Branded header; primary/secondary/destructive buttons; text inputs/password affordance; chips, badge, avatar, board thumbnails, stat tiles, task/Card rows, separators, skeletons, toasts, error/empty containers, bottom sheet, modal, confirmation and preference switch. Use controlled disabled/loading/pressed states.
- **Acceptance:** Representative component gallery matches approved light-theme visual language; labels truncate or wrap correctly; ≥44×44 pt-equivalent touch targets where appropriate; accessible labels, contrast, large font and Android back handling; no accidental Web CSS reuse.
- **Tests/evidence:** Snapshot/component state tests and two-size Android/iOS reference captures; measure contrast and screen-reader semantics; verify logo treatment at small/dark sizes.
- **Out of scope:** Per-screen data and unapproved product features.

### MOB-03 — Expo Router architecture, tab shell, navigation guards and deep-link mapping

- **Type:** Navigation. **Dependencies:** MOB-01, MOB-02; integrate session interfaces from MOB-05 when available.
- **Outcome:** Exactly four authenticated tabs — **Home / My Tasks / Boards / Inbox** — plus public Auth, Search, Calendar, Card, Workspace, Settings and invitation stacks.
- **Implementation:** Define typed route IDs/params and screen groups; route guards (auth loading, signed out, valid, no access); tab/header patterns; navigation provenance for Back; sheet vs full-screen rules; status/safe-area handling. Add one canonical `boardId + cardId` Card route shared by Home, Tasks, Search, Inbox and Board.
- **Deep links:** Map only known `https://kanvexa.tech/...` routes to native screens; validate UUID/path shapes and reject external/open redirect destinations. Handle cold-start, already-open app, sign-in then resume target, archived Card and revoked permission. Draft App/Universal Link association requirements for MOB-46; do not claim domain association works before deployment validation.
- **Acceptance:** Tab switching and nested Back are deterministic; Android hardware Back closes a sheet first; direct Card path never bypasses guard; signed-out users do not briefly see private content; no extra Calendar/Search bottom tab.
- **Tests/evidence:** Route/parser unit tests, nested-navigation integration tests, cold/hot deep-link scenarios, state restoration and unauthorized-route assertions.

### MOB-04 — Typed REST client, TanStack Query conventions and network resilience

- **Type:** Core data layer. **Dependencies:** MOB-01; coordinate with MOB-05/06. **API:** `/api/*` shared envelopes, pagination, raw export/file responses.
- **Outcome:** One safe API transport used by all feature modules and correctly adapted to native networking.
- **Implementation:** Typed fetch client with bearer injection, abort/cancellation, response/body validation, strict error mapping, bounded retries, throttling-aware UI feedback, upload vs download transport, no-store treatment and network status. Distinguish wrapped JSON from `204` no-body and from **binary/raw exports**; never parse an export as normal success envelope or download a JSON error as a file.
- **Query architecture:** Establish `queryKeys` scoped by user/session generation, Board and filters; pagination and dedupe conventions, invalidation helpers, cache-clear boundaries and mutations with rollback/refetch. Never treat `invalidateQueries` call count as proof of actual HTTP requests. Reject Web-specific `window.location`, `localStorage`, browser cookie assumptions.
- **Acceptance:** Request failures never produce success toasts; 401 ends only the current session, 403/404 protects data, 409 offers conflict handling, 429 respects backend policy. Cancellation and stale responses cannot populate another user's cache.
- **Tests/evidence:** Contract tests for malformed JSON, empty/binary body, offline, abort, 401 race, concurrent requests, pagination, API base URL, query-key isolation and invalidation counting; local/staging smoke only.

### MOB-05 — Secure native session lifecycle and authentication state machine

- **Type:** Security foundation. **Dependencies:** MOB-03, MOB-04. **Backend:** existing JWT validation, `/api/users/me`, `/api/auth/logout`.
- **Outcome:** SecureStore-backed login session with explicit transitions: restoring → verifying → authenticated / unauthenticated / expired / offline-uncertain.
- **Implementation:** Persist only required JWT/expiry securely; never AsyncStorage for bearer tokens. Validate local expiry and `/users/me` before rendering protected content on cold boot; define token ownership/session generation and cancellation of in-flight requests. On logout, expiry, 401, password/account invalidation or account switch, disconnect sockets, clear protected query/mutation caches and credentials. Plan cross-device behavior without inventing refresh/active-session endpoints.
- **Native details:** Handle SecureStore read/write failure, OS restore/reinstall/keychain semantics, biometric-lock caveats, background/foreground clock jumps and app process death. Do not show previous account's theme/Board or trust a retained navigation stack after session change.
- **Acceptance:** No private flash on cold load, no old-account result after switching, expired JWT cannot reconnect socket or load a Card, no implicit token renewal. A network failure does not falsely assert that identity is revoked; the state is safe and recoverable.
- **Tests/evidence:** State-machine and fake-clock tests; delayed 401/late response races, corrupted storage, logout during upload, reinstall/restore observations, old/new account boundary QA.
- **Out of scope:** Adding a refresh-token server feature, 2FA or persistent server-side session registry.

### MOB-06 — Socket.IO foreground lifecycle, event reconciliation and access revocation layer

- **Type:** Realtime foundation. **Dependencies:** MOB-04, MOB-05. **API:** existing `/socket.io` and `@kanban/shared` event contracts.
- **Outcome:** Native client receives authoritative invalidation hints while active, disconnects correctly while inactive and reconciles after reconnect/resume.
- **Implementation:** Create authenticated socket with token fetched for each connection; subscribe/unsubscribe per authorized Board/feature; coordinate `AppState`, network reconnect and query refresh; coalesce duplicate mutation/socket invalidations **by affected resource** rather than gating all requests behind unrelated mutations. Distinguish current-user other-tab activity from own local optimistic mutation.
- **Security:** On membership revocation/access change, promptly clear affected private detail/list/notification contents and rerun permissions. Presence is connection-ephemeral; backgrounding/disconnect must remove it through existing server behavior, not invent “last online”.
- **Acceptance:** Two devices see edits after commit; a temporary connection loss produces bounded catch-up fetch; a rejected user never continues displaying or editing a protected Board; unrelated Board mutations do not stall current Board updates; no permanent background socket assumptions.
- **Tests/evidence:** Reconnect, duplicate event, simultaneous edits, missed socket hint, overlapping optimistic mutation, permission revoke, logout/expiry/dispose tests; request-count trace before performance tuning.

### MOB-07 — Mobile testing scaffold, repository CI integration and non-production build profiles

- **Type:** Developer experience / CI. **Dependencies:** MOB-01, MOB-04; consumes early navigation/UI test helpers as available.
- **Outcome:** Mobile changes can be reviewed/tested without breaking current Web CI/CD or triggering costly native builds on every unrelated PR.
- **Implementation:** Add unit/component test runner, mocked API/socket fixtures, deterministic render/navigation helpers, typecheck/lint/format scripts, mobile-specific checks, build smoke and EAS `development` / `preview` / `production` profile skeletons. Verify root recursive commands and CI path filters/caching; maintain existing Web/backend/shared and infrastructure checks.
- **Guardrails:** Native signing secrets, OAuth secrets, Apple/Google store credentials and push service accounts must never be committed. `EXPO_PUBLIC_*` is **public**, suitable only for public endpoints/client IDs. Developers use local/staging service by default; Web deploy remains independent.
- **Acceptance:** New mobile PR fails on broken mobile types/tests but unrelated Web PR is not forced into cloud builds; root lockfile install, lint, test, build and infra checks remain green; no automatic App Store/Play submission.
- **Tests/evidence:** A deliberately failing test check, CI job matrix/cost review, clean runner run, reproducible Android development build instructions; document unavailable iOS E2E limitations honestly.

**P1 integration check:** Clone → `pnpm install --frozen-lockfile` → boot development app → correct logo/tabs → typed local/staging request → session-safe signed-out state → root CI passes. No production credentials or deployment changes.

---

## 5. Phase 2 — Authentication, Home, Workspaces & Board Discovery (MOB-08–14)

**Phase outcome:** A user can authenticate, land on a working Home, find Personal/Team Workspaces, discover/create/star/manage permitted Boards, and follow the same identity/permission rules as Web.

### MOB-08 — Complete email/password authentication and recovery UI

- **Type:** UI + integration. **Dependencies:** MOB-02–05. **Visual:** Approved Authentication group. **Routes:** `POST /api/auth/register`, `/login`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`; `GET /api/users/me`.
- **Implementation:** Native Login, Sign Up, Check Email, resend, Forgot Password, Reset Password and verification success/failure states. Keyboard-aware forms, password visibility, autofill, proper `next`/`done` behavior, validation matching backend and disabled-on-submit protection. Handle registration-email verification requirement, generic recovery acknowledgments and safe resend cooldown/429 handling.
- **Link handling:** Accept verified one-time HTTPS reset/verify links with trust-safe parsing; if association isn't deployed yet, define a secure browser fallback. No logs/analytics of verification proofs; no automatic sign-in if server's verification route does not grant a session.
- **Acceptance:** Register → verify → login works; invalid/reused/expired reset proof is recoverable; back navigation does not leak password; email and password policy errors are actionable; no fake “sent email” assertion beyond backend response.
- **Tests/evidence:** Public auth route integration, register/verify/re-login, duplicate account, rate limit, malformed token, abort, offline and small-screen keyboard QA; parity with actual backend response codes.
- **Out of scope:** Refresh-token, 2FA or new legal agreement fields without existing product approval.

### MOB-09 — Native Google Sign-In and verified backend ID-token exchange

- **Type:** Native integration + security. **Dependencies:** MOB-05, MOB-08. **Routes:** `POST /api/auth/google`, `POST /api/auth/google/link`, `GET /api/auth/linked-providers` (linking UI coordinated with MOB-39).
- **Implementation:** Choose supported Expo/native OAuth approach with correct Android/iOS client IDs, package/bundle identifiers, SHA/signing fingerprints, redirect handling and Google ID-token validation by backend. Reuse Kanvexa JWT returned by server; never send Google access token as REST/Socket authorization. Handle cancel, no Google Play services, provider error, unverified/linked-account conflict, and distinct dev/production identities.
- **Backend contract gate:** Confirm accepted `aud`/issuer rules in current `google-auth.service` and tests. If native mobile client IDs are not accepted, add an explicitly reviewed, strictly allowlisted backend configuration/test change; do not loosen token validation.
- **Acceptance:** Google identity sign-in creates/uses the appropriate Kanvexa account with no account takeover; canceled sign-in leaves session unchanged; return from background works; login/session invalidation follows MOB-05.
- **Tests/evidence:** Mocked native OAuth state tests, backend token audience/issuer tests, at least one physical Android sign-in, iOS signed-build/device check when credentials are ready, signed-out/failure QA.

### MOB-10 — Home Dashboard matching approved design and productivity API

- **Type:** Product UI. **Dependencies:** MOB-02–05, MOB-08. **API:** `GET /api/users/me/home`.
- **Implementation:** Approved branded header, time-appropriate greeting, `My Tasks` and `Due soon` tiles, `Up next`, starred/recent Boards, real Board thumbnails and 4-tab navigation. Use server count semantics and limit (up to six Up Next); do not invent performance or task completion data. Keep optional decorative banner out by default per Design Spec.
- **Navigation:** Statistic tile → supported My Tasks group, Card → native Card Detail with access recheck, Board → Board Detail, `View all/See all` → respective tabs.
- **Acceptance:** Counts/data exactly reflect Home API; no layout jump on fetch; empty/starless account is coherent; long names/timestamps and dark/system theme readable; revoked Board vanishes on authoritative refresh.
- **Tests/evidence:** Fixture contract tests, no-/many-Board, timezone edge, 401/403/offline, pull-to-refresh, cross-tab path assertions; approved screenshot comparison.

### MOB-11 — Workspace discovery, selector and Personal/Team navigation

- **Type:** Product UI. **Dependencies:** MOB-03–05, MOB-08. **API:** `GET /api/workspaces`, `/workspaces/personal`, `GET /api/workspaces/:id`, `/boards`, `/overview`.
- **Implementation:** Approved `Boards` screen Workspace selector, native bottom sheet, Personal/Team differentiation, selected indicator, authorized metadata, changing Board contents with proper cache keys, and direct navigation to Workspace overview/Boards. Treat guest Board access separately from actual Workspace membership; never invent a Workspace for a guest.
- **State:** Keep a per-current-user selection while app is open; reset on logout/account switch and when a Workspace disappears. Show genuine membership/member count only if returned/authorized.
- **Acceptance:** Switching between 0/1/many Team Workspaces replaces correct data without stale flash; Personal Workspace gracefully provisions/displays under existing backend rules; no leaking Board titles across users or different membership contexts.
- **Tests/evidence:** Workspace switching and revoke fixtures, empty/slow list, pagination, special-character names, back navigation and offline cache isolation.

### MOB-12 — Workspace creation, overview, editing and basic lifecycle

- **Type:** Product UI + service integration. **Dependencies:** MOB-11. **API:** `POST /api/workspaces`, `GET/PATCH /api/workspaces/:id`, `/overview`, workspace leave/delete routes as supported.
- **Implementation:** Native Create Workspace, rename/edit details, overview summaries, Personal-vs-Team constraints and appropriate management entry points. Show source-verified actions only for authorized roles; leave/delete must respect ownership/admin/member and linked Board dependencies. Use destructive confirmation and server error/blocker copy, not a locally guessed delete cascade.
- **Acceptance:** Create/rename reflects across Web and mobile; unauthorized edit/leave/delete fails safely; Personal Workspace cannot be treated as an ordinary Team Workspace; failure keeps drafts and navigation state.
- **Tests/evidence:** Permission matrix for admin/member/guest; create duplication, invalid name, constraint error, multi-user removal and cross-device refresh; source-verified endpoint/request body tests.
- **Boundary:** Detailed members/invitations/policies/activity belong to MOB-23–24/27 to prevent oversized overlapping issues.

### MOB-13 — Boards directory, starred Boards, create/edit and background presets

- **Type:** Product UI. **Dependencies:** MOB-11, MOB-12 (for Team create context); MOB-02, 04. **API:** `GET/POST /api/boards`, `GET/PATCH /api/boards/:id`, `/user-state`, `PUT/DELETE /:id/star`, `/background-presets`, `PATCH /:id/background`.
- **Implementation:** Approved Starred Boards carousel/grid and All Boards rows; create/edit sheet with Workspace and privacy defaults; star toggle with proper optimistic rollback; accurate thumbnail/background colors and preset images; search/empty/loading/pagination behavior. Separate row tap from star/overflow hit targets.
- **Acceptance:** User can create permitted Board in correct Workspace, star/unstar without opening it, see background changes from Web, distinguish archived from active Board and respect no-create/read-only roles.
- **Tests/evidence:** Board star conflicts, background preset fallback, empty Board lists, guest visibility, changed membership, upload/image failure, long titles, screenshot parity.
- **Boundary:** Archive/restore/visibility/move and privileged Board operations are MOB-14.

### MOB-14 — Board lifecycle, policy-gated management and settings entry points

- **Type:** Product UI + authorization. **Dependencies:** MOB-12, MOB-13. **API:** `POST /api/boards/:id/archive|restore`, `PATCH /api/boards/:id/visibility`, `POST /api/boards/:id/move-workspace`, policy capabilities, `GET/DELETE /api/boards/:id/sample-removal` (special case), other verified Board settings.
- **Implementation:** Board overflow/details sheet, edit name, contextual visibility and destination Workspace forms, archive/unarchive and read-only warnings, sample Board special removal with its backend-specific confirmation; show capabilities based on actual Board role and policies. Provide links to Members, Activity, Archived Cards and export screens whose functions land in later issues.
- **Security:** Never present generic “Delete Board” by reusing sample-removal; never infer explicit OWNER from Workspace ADMIN. Archived Boards can still be readable/exportable subject to API permissions, but not silently mutable.
- **Acceptance:** Owner/member/guest/Workspace-reader controls differ correctly; move/visibility failures preserve source data; archive and restore synchronize with Web; destructive confirmations cannot be bypassed by rapid taps.
- **Tests/evidence:** Permission/archived/revoked matrix; multi-device archive race; sample-removal refusal/protection; Board move across Workspaces; menu/back/dark-theme UI snapshots.

**P2 integration check:** Register or Google Sign-In → verified account → Home → Workspace switch → create/manage Board → star/background/archive/restore → same state visible in Web. Denied actions remain absent and blocked by server.

---

## 6. Phase 3 — Kanban, Cards, Checklists, Attachments & Table (MOB-15–22)

**Phase outcome:** Authorized users can view and operate real Boards, Columns and Cards with touch-friendly gestures. Every mutation uses the existing server's rules and the approved full-screen Card Detail. Table View is included for parity even though it has no separate hero mockup.

### MOB-15 — Board Detail shell, authorized Card loading, view switcher and Board filters

- **Type:** Product UI + data-performance integration. **Dependencies:** MOB-06, 13–14, 02–04. **Visual:** Approved Board Detail/Filters group. **API:** `GET /api/boards/:id`, Card list/filter, Column list, card-preview summaries, Board policy capabilities.
- **Implementation:** Compact Board/Workspace header, `Board | Table | Calendar` view selector, horizontal columns and vertical Card lists, real Card preview fields, label/due/avatar/checklist/comment/attachment metadata, skeleton/empty states, Board filter sheet with assignee/label/due parameters actually accepted by backend. Navigation into Card Detail retains source Board, filter and scroll position while session/permissions remain valid.
- **Data strategy:** Choose bounded Card loading and summary batching after reviewing merged Web PERF-01/#233 and PERF-02/#234. Handle 0, 1, 100, 101, 250+ Cards and many Columns without silent truncation. Avoid N+1 previews and naive concurrent OFFSET snapshots; measure real HTTP and render count before optimizing.
- **Read-only:** Archived Board, guest viewer or revoked user must not see live mutation controls; Card preview tap still routes through server's current read checks. Filter counts must represent actual Board source, not only a partial page.
- **Acceptance:** Correct Column/Card order and total representation; filter Reset/Apply and switching views maintain compatible state; horizontal column swipe does not block vertical scrolling; Card route/back restores position; unauthorized Board cannot flash cached data.
- **Tests/evidence:** Large dataset matrix, slow pagination with concurrent edits, access revoke while open, multi-device Board edits, reconnect, long labels/date strings, Android touch capture and performance trace; explicitly document any backend contract limitation.
- **Boundary:** Column/Card write operations go to MOB-16/17; view-specific Table/Calendar to MOB-22/35–36.

### MOB-16 — Column creation, editing, ordering and removal

- **Type:** Kanban interaction. **Dependencies:** MOB-15. **API:** `GET/POST/PATCH/DELETE /api/boards/:boardId/columns`, `PATCH /:columnId/move`.
- **Implementation:** Column add form, inline/Sheet rename, `Move left / Move right` menu and accessible ordering; optional touch drag only if library behavior is stable and preserves vertical Card scroll. Validate current semantics for deletion with existing Cards before exposing destructive control. Use accurate server ordering and post-commit invalidation.
- **Acceptance:** New/renamed/moved Column shows on both clients, Card associations remain correct, deletion conflict/error is intelligible, archived/read-only Board disallows edits, no duplicate Column from double-submit.
- **Tests/evidence:** Empty Board, first/last Column move, 30+ Columns, concurrent reorders, background/reconnect, 403/409/429, keyboard/screen-reader alternatives; underlying service contract fixtures.
- **Boundary:** Do not redesign backend ordering or silently drop cards because delete UX is simpler.

### MOB-17 — Card create/edit/move/reorder, duplicate, archive and restore

- **Type:** Kanban business operations. **Dependencies:** MOB-15–16. **API:** `GET/POST/PATCH /api/boards/:id/cards`, `PATCH /:cardId/move`, `POST /:cardId/duplicate`, `/archive`, `/restore`.
- **Implementation:** Authorized Add Card bottom sheet with title/Column context, Card rename/actions, move-to-Column picker, same-column reorder and cross-column move, duplicate, archive and archive listing/restore route. Prefer reliable drag plus explicit accessible Move action; never make precision drag mandatory. Use API-provided ranking/position rules and server snapshot on conflict; no cross-Board move unless actually supported.
- **Optimistic safety:** Track in-flight mutation per resource and reconcile socket hints without overwrite; if failed, undo optimistic position and re-fetch authoritative order. Do not replace a user's unsaved Card Detail draft when another actor edits the Card.
- **Acceptance:** Cross-device Card order remains correct after create/move/duplicate/archive/restore; duplicate copies only contract-supported fields; an archived Card is read-only; archived Board blocks child mutation; all destructive actions confirm as Web does.
- **Tests/evidence:** Reorder first/last/empty Column, simultaneous move/reconnect, rapid taps, `409` contention and stale cache, revoked access, duplicate exclusions, restore ordered placement, gesture QA on small Android and iPhone-sized view.
- **Out of scope:** Hard-delete Card, task priority field or independent offline operation queue.

### MOB-18 — Full-screen Card Detail, description editor and contextual actions

- **Type:** High-priority screen UI. **Dependencies:** MOB-17, MOB-02–04. **Visual:** Approved Card Detail design.
- **Implementation:** Single scrolling native Card screen: Board/Column breadcrumb, wrapped title, label/assignee/date slots, description read/edit with explicit Save/Cancel, lower checklists/attachments/comments regions and compact contextual sticky actions. Build section containers with stable skeleton/error/empty patterns so subfeatures can land independently; no nested full-screen Web modal.
- **Interaction:** Keyboard avoidance, scroll-to-editor, unsaved-change guard on Back/tab/deep link, safe rich text display, long copy handling, private links and role-gated overflow actions. Shared route works from Home, Board, Tasks, Search and Inbox; archived Card view is readable but no false edit CTA.
- **Acceptance:** Screen layout matches approved references with real Card data; description edits save only after server confirmation; cancel/discard behavior never loses draft silently; access revocation removes content; loading a Card directly from a link works.
- **Tests/evidence:** Cold deep link, cross-Board entry and Back, long markdown/text/link handling, editing vs concurrent change, 401/403/404/409, Android keyboard, screen reader, narrow/large font screenshots.
- **Boundary:** Actual metadata/checklist/file/comment business mutations are MOB-19–21/26.

### MOB-19 — Card assignees, Board labels and start/due-date editing

- **Type:** Card metadata. **Dependencies:** MOB-18, MOB-16/17 for Column context. **API:** Card assignee add/remove, Board label catalog CRUD and per-Card label assignments; Card start/due fields via existing Card PATCH.
- **Implementation:** Native member selector with authorized Board member list, label picker + color chips + Board catalog management where permitted, date picker that round-trips **ISO 8601 instants with timezone offset**, and native displayed due states from account preferences. Use the exact backend validation for `startDate <= dueDate`, omission/null semantics and user/Board role.
- **Acceptance:** Assignee/label changes reconcile across Web/mobile; unlisted member cannot be assigned by client guess; due status and relative date match saved timezone; date-only picker never sends unsupported date-only string; long label names readable; archived Card/Board prevents mutation.
- **Tests/evidence:** Time zone/day-boundary/DST cases, blank start/due, zero/large catalog, label rename/delete affecting Cards, simultaneous assignment changes, permission matrix, stale-cache rollback.
- **Boundary:** “Priority”, “High” and other mockup chips are ordinary configurable labels, not a new priority table/field.

### MOB-20 — Checklists, checklist items, ordering and completion progress

- **Type:** Rich Card feature. **Dependencies:** MOB-18; shared metadata in MOB-17. **API:** `/api/boards/:boardId/cards/:cardId/checklists` and nested items, summary, move, edit, delete routes.
- **Implementation:** Multiple checklist sections, accurate checked/total progress, add/edit/remove Checklist, add/toggle/rename/remove/reorder Item and checklist ordering via explicit mobile actions. Keep a checklist-local mutation queue where necessary so rapid checkbox taps and realtime events cannot reverse newer user intent.
- **Acceptance:** Progress fraction/bar always matches latest valid items; reorder persists after navigate away; archived Card/Board view is read-only; errors roll back affected item only; checked toggles remain keyboard/screen-reader accessible.
- **Tests/evidence:** 0/1/many lists, 0/100% progress, rapid concurrent toggles, two-device check/uncheck, delete-with-update race, 409/403/404, offline failure and recovery; native tap-target/overflow captures.
- **Out of scope:** Task completion as a separate global task status inferred from a completed checklist.

### MOB-21 — URL attachments, private file upload/download and native media safety

- **Type:** Native files + security-critical integration. **Dependencies:** MOB-18, MOB-04–05. **API:** Card URL attachments, upload-intent/owned upload/complete/cancel, authenticated file streaming; avatar flow is separate MOB-37.
- **Implementation:** Add/edit/delete HTTPS URL attachments; device document/photo picker for private files; detect real size/type and declared hash/digest according to the current protocol; begin upload intent → transfer through the **allowed** S3/local driver path → complete/verify → render active attachment. Implement cancel/retry and pending lease expiry handling. Download/open/share via authorized native private temp file with cleanup and safe file naming, not raw public URL.
- **Limits:** Respect inspected server policy (historically **10 MiB/file, 20 attachments/Card, 100 MiB/Board**; reconfirm before coding), whitelist/rate limits, `Idempotency-Key`, response validation and attachment revision. No global unrestricted file upload.
- **Acceptance:** Authenticated allowed user can upload from a real phone and view from Web; expired/invalid/revoked reader cannot download; interrupted uploads do not appear active; never save 403/error JSON as a file; user can cancel native picker without an error toast.
- **Tests/evidence:** URL validation, MIME mismatch, over-limit, checksum failure, local/S3 driver paths where configured, Wi-Fi loss, background/resume, same file race, logout during transfer, storage permission denial, temporary-file deletion and security checks.
- **Boundary:** No new public bucket, direct public S3 links or speculative unlimited attachments.

### MOB-22 — Board Table View and shared Kanban/Table view behavior

- **Type:** Feature parity UI. **Dependencies:** MOB-15, MOB-17, MOB-19. **API:** Existing Board Cards/filter/sort and Card detail route; use latest Web Table semantics as the contract.
- **Implementation:** Native dense row/table experience with readable Card name, Column, assignees, labels, due date and whatever current Web Table **actually** provides. Use horizontal scroll/column configuration or a compact row inspector for phones; avoid a tiny unreadable desktop grid. Preserve Card ordering, filters, sorting, authorized summary metadata and navigation into full Card Detail.
- **Acceptance:** Same authorized Card set as Kanban under compatible filters; all rows can be opened; no arbitrary partial-list totals; long cells and many columns are navigable; read-only and access loss are enforced; appropriate empty/load/error presentation.
- **Tests/evidence:** Compare fixtures with Web Table, sort/filter combinations, 250+ Cards, portrait/landscape, accessibility order, context menu and native touch/scroll performance traces.
- **Boundary:** Calendar is a separate phase-5 view (MOB-35/36), but Board view selector can expose it only when implemented; no fake tab content in production.

**P3 integration check:** On phone: open authorized Board → create/edit/reorder Column → add/move/duplicate/archive/restore Card → edit Card text, labels, assignments, dates/checklist/attachments → switch Table → same state on Web. Revoked/archived states stay safe.

---

## 7. Phase 4 — Collaboration, Membership, Activity & Presence (MOB-23–28)

**Phase outcome:** Users collaborate on the same Workspaces/Boards across Web and mobile without stale privileges, lost edits or inconsistent notifications.

### MOB-23 — Workspace members, roles, guests, policies and leave/remove management

- **Type:** Collaboration admin. **Dependencies:** MOB-12, MOB-05, MOB-04. **API:** `GET/PATCH/DELETE /api/workspaces/:id/members`, `/guests`, `/policies`, `POST /leave` and current Workspace permission services.
- **Implementation:** Workspace Members screen; authorized role change/remove, guest list, policy view/edit where supported and leave action. Distinguish Workspace membership from Board guest permissions and explicit Board role; show protected/disabled reasons. Keep platform-native confirmation for removal/demotion/leave and reconcile cached Workspace/Board menus.
- **Acceptance:** Only authorized actor sees change controls; permissions and member list match Web; membership removal closes restricted screens; no hidden guest becomes a Team member in UI; blocked last-admin/owner-like constraints remain backend-authoritative.
- **Tests/evidence:** ADMIN/MEMBER/guest/outsider matrix; self-leave, remove current user, concurrent role change, access revoke, policy denial, last-admin restrictions and stale screen caches.

### MOB-24 — Workspace invitations: send, list, cancel, accept and decline

- **Type:** Collaboration + link handling. **Dependencies:** MOB-23, MOB-08, MOB-03. **API:** `/api/workspaces/:id/invitations`, `POST /api/workspace-invitations/accept|decline`.
- **Implementation:** Invite member sheet with email/role rules, pending invitation list and status, cancel action, safe accept/decline route from email or an in-app link, generic/non-enumerating errors and sign-in-then-resume. Distinguish invitation send/accept state from a guaranteed email delivery; use server's exact invitation proof and expiry protocol.
- **Acceptance:** Valid invited user accepts and sees the Workspace; decline does not join; stale/revoked/expired proof cannot join; wrong signed-in account is handled safely; invitation deep link remains functional after app process death or browser fallback.
- **Tests/evidence:** Invite/cancel/resend where supported, invalid role, already member, email mismatch, revoked inviter, duplicate acceptance, proof leakage checks, offline/429 and Android/iOS link navigation.
- **Boundary:** No new invitation type or board-invitation workflow inferred from notification enum names.

### MOB-25 — Board membership, Board roles and capability-aware access controls

- **Type:** Board collaboration. **Dependencies:** MOB-14, MOB-23, MOB-15. **API:** `GET/POST/PATCH/DELETE /api/boards/:boardId/members`, Board detail and policy capabilities.
- **Implementation:** Board Members screen, role badges and actions for explicit Board OWNER/MEMBER, add/remove/change role under current Board and Workspace visibility policies; matching board/share entry points and current user's restrictions. Use verified backend capability/role sources, not a locally stored boolean.
- **Acceptance:** An outsider/private Board cannot list members; permission change updates Web/mobile; read-only guest can still read only what current server allows; Board OWNER-only operations remain OWNER-only; user removal closes protected Card views and clears caches.
- **Tests/evidence:** Board OWNER/MEMBER, Workspace ADMIN without Board membership, guest Board OWNER/MEMBER, outsider and archived Board; simultaneous remove/open Card, invalid role and last-owner safeguards.

### MOB-26 — Card comments, author operations and @mentions composer

- **Type:** Rich collaboration UI. **Dependencies:** MOB-18, MOB-25; MOB-06 for live updates. **API:** `GET/POST/PATCH/DELETE /api/boards/:boardId/cards/:cardId/comments`, existing typed mention metadata.
- **Implementation:** Comment list with author/avatar/timestamp, Add/Edit/Delete according to actual server ownership/role, optimistic or confirmed posting with safe retry; native multiline keyboard composer and member suggestion for `@mention`. Preserve backend-authoritative UTF-16 span offsets (JS strings use UTF-16); never rebuild mention identities from plain text alone.
- **Security/content:** Treat comment bodies as text, no HTML injection; filter suggestions by current permissions; do not retain removed members' private details; unavailable/deleted comments show supported fallback. Use rate limits and avoid duplicate comment on retry.
- **Acceptance:** Mention receives intended server effect; edit/delete restricted to valid actors; concurrent new comments merge correctly; user draft survives a recoverable failure, not role revoke; comment counts and notifications refresh without double requests.
- **Tests/evidence:** Unicode/emoji/surrogate mention spans, duplicate text names, two-device comment edits/deletions, offline retries, 401/403/409, keyboard/long comment/large font and screen-reader QA.

### MOB-27 — Workspace and Board activity history, privacy-aware audit presentation

- **Type:** Read-only collaboration surfaces. **Dependencies:** MOB-12, MOB-14, MOB-25. **API:** `GET /api/workspaces/:id/activity`, `GET /api/boards/:id/activities` and only verified server scopes.
- **Implementation:** Activity feed entries by time, actor/context, safe target navigation and empty/load/more states. Add Workspace/Board activity access from approved menus; only show event labels, pagination and Card-level history where supported. Do not create invented client-side events as audit history.
- **Acceptance:** Activity only exposes records current user may see; historical actor/resource missing/deleted state is understandable; deep link rechecks access; no private context persists after membership loss; relative/exact time follows Preferences.
- **Tests/evidence:** Many events and pagination, missing actors, archived Board, guest viewer, role revocation, account deletion attribution, offline and timestamp boundary tests.

### MOB-28 — Presence, multi-user realtime behavior and collaboration conflict hardening

- **Type:** Cross-feature integration. **Dependencies:** MOB-06, MOB-17, MOB-23–27.
- **Implementation:** Visible Board presence backed by actual `presence:sync` (or current shared event) and current authorized connection state. Update Card/Column/checklist/comment/member activity safely in place, coordinate local mutation success with socket hints and bounded refetch. Conflicts preserve in-progress edits or present explicit refresh/discard resolution. Reconnect/resume and app background close/reconcile appropriately.
- **Access:** On Board/Workspace revoke, purge private details, selection and stale presence; stop write actions and reroute safely. Do not broadcast other users' data outside current Board or build fake last-seen timelines.
- **Acceptance:** Two devices/tabs edit distinct parts without lost updates; local save and socket hint do not cause repeated full-Board fetch; no stale authorized socket after account/password change; reconnect restores authoritative data and current presence; other user's optimistic work remains untouched.
- **Tests/evidence:** Real-backend Socket.IO + PostgreSQL cross-device integration, multi-tab same account, background/foreground, offline, simultaneous move/checklist/comment, revoke-during-edit, performance request trace and absence of cache leaks.

**P4 integration check:** Invite Workspace user → accept on mobile → add to Board → comment with mention → live Card move/Checklist update → Board/Workspace activity → revoke user while Card open → restricted information immediately disappears and server rejects writes.

---

## 8. Phase 5 — My Tasks, Search, Notifications, Calendar (MOB-29–36)

**Phase outcome:** Cross-Board productivity feels native and data-safe; no misleading Completed counts, unsupported Search filters, synthetic calendar meetings or fake push subscriptions. Calendar supports real Board-based dates and Month/Week layouts.

### MOB-29 — Cross-Workspace My Tasks, grouping, filters and sorting

- **Type:** High-visibility product UI. **Dependencies:** MOB-10, MOB-17, MOB-04. **Visual:** Approved My Tasks group. **API:** `GET /api/users/me/tasks` with `page`, `limit`, `group`, `workspaceId`, `boardId`, `labelIds`, `dueFrom`, `dueTo`, `sort`.
- **Implementation:** `My Tasks` tab with status chips, overdue/next-seven-days/later/no-date sections, task count badges, collapsible grouping and Board grouping presentation. Use backend groups `ALL`, `OVERDUE`, `NEXT_7_DAYS`, `LATER`, `NO_DUE_DATE`, `groupCounts` and server pagination. Build filter sheet for Workspace/Board/label/date; maintain selected filters and page reset on changes. Card tap uses canonical native Card route.
- **API/design gate:** The approved screenshot includes `Completed`, but current response returns **active assigned Cards only**. Do not invent a Completed count or locally infer it from checklist completion. Record D-04 resolution: recommended Web-parity variant maps that chip to a genuine supported grouping only with owner-approved visual correction; adding completed-state API is a separate explicit product change.
- **Acceptance:** Filters/sorts return exactly authorized server values; no cross-Workspace data aggregation from a partial fetched page; due ordering matches backend; stale Card after revoke disappears; no duplicated row across pages under ordinary stable dataset.
- **Tests/evidence:** Server response DTO fixtures, 0/1/many task groups, timezone today/overdue border, workspace+board mismatch, label OR semantics, pagination 20/100, simultaneous assignment change, offline/reconnect, long titles and approved visual comparison.

### MOB-30 — Global Search, grouped results, pagination and safe routing

- **Type:** Product UI + optional minimal API gap resolution. **Dependencies:** MOB-03–05, MOB-11, MOB-18. **Visual:** Approved Search group. **API:** `GET /api/search?q=...&type=all|workspaces|boards|cards&limit=...&page=...` with contract-specific limits.
- **Implementation:** Full-screen Search (no bottom tab), keyboard focus, query debounce/cancel, recent query UI only if privacy-safe, grouped Workspaces/Boards/Cards results, highlighted safe text (not HTML), type chips, group `View all`, specific-type server pagination and direct authorized target routing. Default blank query is not an API-driven recommendation list.
- **Contract gate:** Current server rejects `workspaceId` and `boardId` search params. The approved Filter sheet must **either** be limited to supported type filtering after approved visual variance **or** have an explicit tiny ACL-safe server extension reviewed with DTO/index/authorization tests; client filtering of a truncated group is not an acceptable substitute. `type=all` does **not** accept `page`.
- **Acceptance:** Search 0–120 Unicode code points, literal metacharacters and multi-word text correctly; result counts are server counts; no unauthorized titles/snippets; opening a Card from Search works after cold auth; Back retains query when safe.
- **Tests/evidence:** Fast typing/cancel race, emoji, `%_\\` literal query, grouped limit/pagination, query privacy history reset on logout, permission revoke, inaccessible result, offline/429, screen-reader highlights.

### MOB-31 — Inbox list, unread count, read actions and notification deep links

- **Type:** Product UI. **Dependencies:** MOB-04–06, MOB-03. **Visual:** Approved Inbox All/Unread. **API:** `GET /api/notifications?filter=all|unread&page&limit`, `/unread-count`, `PATCH /:id/read`, `POST /read-all`.
- **Implementation:** Today/Yesterday/Earlier sections, unread tint/dot, type-specific icon, actor/Board/Card context only when currently accessible, All/Unread tabs with authoritative count, Mark as Read/Mark All as Read, load more. Socket `notifications:changed` triggers coalesced refresh; on background reconnect, reconcile inbox and unread count.
- **Privacy:** A notification rendered as an unavailable stub after access change must never regain stale actor/target/context from delayed mark-read; links target only validated internal destinations and still pass access checks. Do not render notification text as HTML.
- **Acceptance:** Read one/all updates count on mobile and Web; read response only mutates supported read state; auth change removes old inbox; inaccessible notification is safe and non-clickable; no infinite refetch loop.
- **Tests/evidence:** Duplicate/read-all concurrency, 0/99/100+ badges, pagination after read, day boundary timezone, content deleted/revoked, websocket reconnect and offline, device screen reader and scroll.

### MOB-32 — Real in-app/email Notification Preferences UI

- **Type:** Settings feature. **Dependencies:** MOB-31. **API:** `GET/PATCH /api/users/me/notification-preferences`.
- **Implementation:** Approved settings sections using **six real in-app** leaves (`cardAssigned`, `commentMentioned`, `workspaceInvited`, `boardInvited`, `membershipChanged`, `dueReminder`) and **three real email** leaves (`cardAssigned`, `commentMentioned`, `dueReminder`). Align labels with actual current emission and feature flags; clearly note best-effort delivery. Use Save/Cancel + unsaved draft confirmation, patch only changed boolean leaves and adopt authoritative response.
- **Contract:** Security/account email cannot be switched off via these preference fields; reserved/not-emitted kinds require honest explanation. Saved enabled state does not prove server's optional email dispatcher is enabled. Push preferences are **not** the same leaves and are MOB-33/34 only after contracts exist.
- **Acceptance:** Changes persist across Web/mobile; offline failure leaves form draft; out-of-order saves do not reset newer edits; notification inbox remains independent of preference loading.
- **Tests/evidence:** All nine leaves, nested partial PATCH, unsupported field rejection, flag off/on copy, failed refetch with dirty form, logout during save, accessibility for toggles.

### MOB-33 — Native push notifications, safe device registration and delivery (capability gate)

- **Type:** Native integration + **additive backend only if approved**. **Dependencies:** MOB-03–06, MOB-31–32. **Visual:** `Push notifications` option from approved settings mockup.
- **Decision prerequisite:** Existing backend has Inbox/socket events but **no verified push device registry/dispatcher**. Resolve D-06 before coding. To deliver the visual control as a working feature, approve and implement the _entire_ bounded native push channel; otherwise obtain an explicit product-approved visual adjustment and document why in-app Inbox remains fully functional. **Never ship an active switch that does nothing.**
- **If included, implementation:** Native permission request after contextual user action; Expo/FCM/APNs token registration with user-scoped authenticated device records, platform/app environment, rotation, unregister on logout/deletion; server outbox after DB commit, dedupe, retry/backoff/receipts, invalid token cleanup, opt-in preferences and feature-flagged rollout. Notifications carry generic private-safe payload plus opaque target ID/path, never raw Card/comment/invitation proof. Push tap authenticates and re-authorizes route.
- **Acceptance:** No pushes to prior account after sign out/switch; disabled/denied permission leaves normal Inbox usable; delivery failures do not duplicate in-app notification; foreground/background/tap flow correct on actual Android and iOS devices.
- **Tests/evidence:** Device token spoof/ownership, token rotation, permission reject, network offline, revoked Board, batch duplicate, provider invalid token, staging/prod credential isolation, two-device signout, payload redaction, push receipt monitoring.
- **Boundary:** Push is a delivery channel, not authorization to create unrelated notification categories.

### MOB-34 — Quiet hours / notification schedule semantics (capability gate)

- **Type:** Product-contract alignment. **Dependencies:** MOB-32, MOB-33 **if push ships**. **Visual:** `Notification schedule`/quiet hours in approved Preferences reference.
- **Decision prerequisite:** Existing preference contract has no quiet-hour fields. Resolve D-07: do not store local-only schedule while server continues pushing at forbidden times. Owner can approve a bounded server schedule or a visual adjustment that excludes the unsupported action from shipped UI.
- **If included, implementation:** Define IANA-timezone user schedule, overnight window, DST edge cases, policy for due reminders vs security emails, opt-in defaults and server-time enforcement at push dispatch. Determine whether notifications are delayed, dropped or batched; document this explicitly and test it. Update `@kanban/shared`, DTOs/migration only if needed and minimal.
- **Acceptance:** Schedule changes synchronize across devices, quiet period is honored server-side, email/security events are not incorrectly suppressed, timezone changes are deterministic; no misleading control for an unimplemented rule.
- **Tests/evidence:** 22:00–07:00 crossing midnight, DST, timezone travel/setting change, disabled push, app uninstalled, eventual delivery/expiry and rapid preference update.
- **Boundary:** No generalized scheduler rewrite or new arbitrary task reminder system.

### MOB-35 — Board Calendar Month view, filters and date semantics

- **Type:** Board view parity. **Dependencies:** MOB-15, MOB-18–19; coordinates view switching with MOB-22. **Visual:** Approved Calendar Month + Filters. **Source:** current Web `CalendarBoard.tsx` and calendar helpers.
- **Implementation:** Monthly grid with selected day, week-start preference, Today/previous/next navigation, colored due markers/counts, scrollable daily agenda and direct Card Detail links. Scope entered-from-Board Calendar to that Board. Apply supported assignee/label/due filters without losing Cards; if a cross-Workspace Calendar entry is required, get an explicitly authorized date-window API first rather than scanning every Board client-side.
- **Semantics:** Start/due timestamps are UTC instants with preferred timezone display. Follow **current Web due-day grouping**, not mockup-implied multi-day meetings; no fake scheduled event duration. Use returned Card date fields, not hardcoded events.
- **Acceptance:** Same dated Cards as Web in the same Board/filter/timezone; 5/6 calendar-row months and leap years render correctly; an empty selected day is useful; archived/inaccessible Cards respect server rules; no lost Card from concurrent multi-page fetch.
- **Tests/evidence:** February/leap year, Mon/Sun week start, timezone/DST boundary, multiple Cards/day, start-only vs due-only, 250+ Cards, month navigation and tab switch, ACL revoke.

### MOB-36 — Calendar Week view, native agenda and Month/Week consistency

- **Type:** Board view parity and native UX. **Dependencies:** MOB-35. **Visual:** Approved Calendar Week reference.
- **Implementation:** Seven-day date strip, selected day, week navigation/Today, same Card data/filters as Month, grouped agenda/list and accessible selection. The reference contains hourly time blocks; draw only if **real supported field semantics justify them**. A single `dueDate` is a deadline point, not a 90-minute meeting. If no verified start/end event model exists, a timeline-like agenda with truthful due-time labels is the correct functional implementation, with variance log.
- **Acceptance:** Switching Month ↔ Week preserves selected day and Board filters; Card counts match; navigation handles year boundary, DST and no-due Cards according to documented semantics; touching entry opens Card Detail and returns to same view state.
- **Tests/evidence:** Sunday/Monday week transitions, December/January crossover, timezone changes mid-session, multiple deadlines at same time, all-day/unknown-time copy, offline data and long label text.

**P5 integration check:** A user sees assigned Cards in My Tasks → searches a Card → opens Card Detail → returns to Search → reads Inbox notification → opens Board Calendar Month/Week → changes due date on Web → mobile reflects it. Push/quiet-hour presentation is truthful according to the explicit D-06/D-07 outcome.

---

## 9. Phase 6 — Profile, Preferences, Account Security & Data (MOB-37–41)

**Phase outcome:** Account screens match the approved design and current verified Web capability, including secure exports/account deletion, with no fake 2FA/sessions/Bio/locale toggles.

### MOB-37 — Profile, avatar and verified email-change flow

- **Type:** Product settings + native media. **Dependencies:** MOB-05, MOB-08–09, MOB-04, MOB-02. **Visual:** Profile, Edit Profile, Change Email. **API:** `GET/PATCH /api/users/me`; avatar upload-intent/complete/file flow, `DELETE /api/users/me/avatar`; current email-change routes after source verification.
- **Implementation:** Profile card and edit form with actual editable account fields; image picker/crop where permitted, secure avatar upload/replace/remove with file verification, default avatar fallback and optimistic preview only with correct rollback. Implement current Web email-change initiation, proof/verification and session effect **after checking the latest P5 controller/service contract**, not by guessing routes.
- **Data model gate:** Mockup Bio has no verified persisted field. Do not show it as editable unless a separately approved supported field exists; timezone links to Preferences instead of being stored in Profile. Never leak full user email to an unrelated membership surface.
- **Acceptance:** Profile/avatar updates visible on Web/mobile; invalid name/avatar type/size and upload cancellation handled; email change cannot bypass verification/reauth rules; unsaved change guard works.
- **Tests/evidence:** Profile PATCH DTO matrix, avatar upload revocation/lease, storage denial, account switch, email proof expiration/reuse and cross-device change, small-screen keyboard and large-text captures.

### MOB-38 — Appearance, time zone, date format and week-start Preferences

- **Type:** Settings UI + cross-platform consistency. **Dependencies:** MOB-02, MOB-05, MOB-04. **API:** `GET/PATCH /api/users/me/preferences`.
- **Implementation:** Appearance choices **Light / Dark / Match System**, account-synchronized user theme, explicit Preferences for IANA timezone, `DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD`, and `monday | sunday`. Native OS theme changes apply only when mode `system`. Preview cards and grouped settings rows match approved theme; save semantics align with existing Web behavior.
- **Acceptance:** Preference update on Web appears on mobile; date/time formatting consistent in Card, My Tasks, Inbox and Calendar; no previous account's theme displayed during identity bootstrap; timezone avoids incorrectly shifting a Card's persisted UTC instant.
- **Tests/evidence:** Full enum validation, system dark/light transitions, timezone/offset boundaries, unsaved draft conflict, out-of-order saves, offline error and device font scale.
- **Boundary:** The mockup Language picker is not an actual localization capability. Do not create a nonfunctional locale selector; any multilingual feature needs separate product approval.

### MOB-39 — Security, password change and connected Google account

- **Type:** Security + settings. **Dependencies:** MOB-05, MOB-08–09. **API:** `POST /api/auth/change-password`, `/forgot-password`, `GET /api/auth/linked-providers`, `POST /api/auth/google/link`; existing password validation and session invalidation.
- **Implementation:** Security screen with actual password-change form/current-password checks, secure keyboard/autofill, recover account route, linked-provider status and current-password + fresh Google ID-token linking flow. Clear client auth/socket/cache when server invalidates existing credentials. Do not claim a security change succeeded before server response.
- **Capability gate:** The approved mockup includes `Active sessions`, 2FA and login activity, but no matching verified registry/2FA/audit endpoints were found. Record D-08 and implement only supported controls; any future new backend security feature requires distinct threat model, schema/API/tests and explicit owner approval.
- **Acceptance:** Password change/recovery honors real strength policy, old socket cannot remain authenticated after revocation, Google link prevents unverified account takeover, errors do not leak identity or secret material; unsupported controls are not actionable.
- **Tests/evidence:** Wrong/current password, expired JWT, delayed socket event, concurrent security change, OAuth canceled/mismatched, locked network, 401/429, keyboard and password manager support, security review.

### MOB-40 — Native account & authorized Board JSON/CSV export and secure file handling

- **Type:** Data & privacy / native files. **Dependencies:** MOB-14, MOB-21, MOB-05. **API:** `GET /api/users/me/export` and `GET /api/boards/:boardId/export?format=json|csv`.
- **Implementation:** Account export action in Data & Privacy; explicit Board OWNER-only JSON/CSV export from Board settings. Stream/download authenticated bytes into private temporary app storage; use safe server-controlled filename or documented fallback, then user-selected save/share location; clean temporary file on completion/cancel/error. Respect content-type, size limits, no-store and 204 vs 200 semantics.
- **Security:** Account export only returns current user's authorized metadata, **not** all Board/file bytes; Board export requires explicit **Board OWNER**, including special guest OWNER where backend permits, and supports archived Board per contract. A Workspace ADMIN without Board ownership is not automatically allowed. Do not store error JSON as a `.csv` or leak tokens in filenames/URLs.
- **Acceptance:** Correct file contents open in native share target, no private file persists after denied operation, 413/429/expired session recoverable, non-OWNER Board export hidden and server denied, user cancels share with no false success.
- **Tests/evidence:** Real download payload and headers, Board JSON/CSV, 20 MiB limit per current contract, long filename, Unicode, device storage denial, logout mid-download, owner/member/guest/admin matrix and error-stream handling.

### MOB-41 — Data & Privacy landing, verified account deletion and complete Settings information architecture

- **Type:** Product settings + destructive security flow. **Dependencies:** MOB-37–40, MOB-32. **API:** `DELETE /api/users/me` with exact confirmation + current password or fresh linked Google credential; data blocker errors, account email-change and export links.
- **Implementation:** Approved Profile & Settings grouped landing, account/appearance/notifications/security/connected accounts/data navigation, isolated red Sign Out, Data & Privacy content and irreversible Delete Account confirmation/re-auth flow. Show actual blockers (`PERSONAL_WORKSPACE_HAS_BOARDS`, `BOARD_REQUIRES_ANOTHER_OWNER`, `TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN`) with actionable resource references, then retry only after corrected server state.
- **Safety:** A 204 deletion ends session, clears SecureStore, all protected caches and sockets, local recent search/history and sensitive temporary files, then routes to public Auth. Never wipe a shared Board's content or claim the backend has a cascade it doesn't. Session expiry mid-delete must not show a success screen.
- **Acceptance:** Account deletion cannot accidentally fire from first menu tap; blocked case explains precise next actions; success leaves no authenticated view reachable by Back; Sign Out and account switch do not leak prior user's settings or files; all Settings rows lead to working supported destinations.
- **Tests/evidence:** Exact confirmation validation, wrong reauth, Google-linked case, each blocker type, concurrent dependency change, 429/401, cancel and re-entry, cold restart after deletion, screen-reader/destructive styling and long text.

**P6 integration check:** User edits profile/avatar → syncs theme/timezone with Web → changes password/links Google → exports account/Board (only with permission) → tests blocked account deletion → valid delete logs out everywhere through authoritative state. No unsupported security feature is presented as working.

---

## 10. Phase 7 — Quality, Security, Performance & Android/iOS Release (MOB-42–47)

**Phase outcome:** A release candidate that matches Web functionality, approved mobile design, server access rules and real device behavior on Android/iOS. This is **not** an “optimization after MVP” phase: it is the mandatory finish of the single complete implementation plan.

### MOB-42 — Full Web ↔ Mobile feature-parity matrix and cross-platform E2E suite

- **Type:** Cross-feature QA. **Dependencies:** All functional MOB-08–41 and resolved gates D-01–D-14; scaffold from MOB-07.
- **Implementation:** Convert §1.2 inventory and Design Spec §10 journeys into executable/recorded acceptance scenarios for **Android, iOS and Web against the same controlled backend fixture**. Build deterministic feature fixtures for Workspaces, guests, Boards, archived status, Columns, Cards, attachments, assignment, notifications, invites, account settings, export and deletion. Validate UI entry routes, operations, response/error semantics and cross-device visibility.
- **E2E critical journeys:** Register/verify/auth → Workspace/Board create → Column/Card create → label/assign/date/checklist/comment/upload → move/archive/restore → Search/Tasks/Calendar/Table → notification/read → export → role revoke; and account security flows. Use production-like role rules with test accounts, not actual user data.
- **Coverage reporting:** Each scope row must be `implemented+tested`, `intentionally not applicable due to approved variance`, or `blocked` with linked issue. No “looks done” state and no checking off a suite that never ran.
- **Acceptance:** No unresolved functional parity blockers; all supported Web role/capability behavior has a native path; cross-platform flows pass against a controlled backend; navigation dead ends and fake interactions are absent.
- **Tests/evidence:** Per-platform test report, API contract revisions, screenshot baseline, log of manual-only device tests and explicit untested environments.

### MOB-43 — Mobile security, privacy, resilience and abuse-case verification

- **Type:** Security QA/hardening. **Dependencies:** MOB-05–06, MOB-09, MOB-21, MOB-24, MOB-26, MOB-31, MOB-33 (if shipped), MOB-37–41.
- **Implementation:** Threat-model token/keychain storage, OAuth/deep-link exchange, private file lifecycle, notification payloads, session generation, clipboard/share targets, logs/crash reports and cache isolation. Verify no secrets in source maps, exception body, telemetry, search recents or OS notifications; remove sensitive temp files when practical. Use network proxy/fault injection against **local/staging only**.
- **Abuse matrix:** Invalid/expired JWT, 401 after account switch, Board/Workspace revoke while viewing, forged deep link/route ID, outsider file export, canceled OAuth, old device push token, malformed JSON, corrupted server data, 429, offline mutation and concurrent archive/delete.
- **Acceptance:** Cannot reach/access server-protected resources via navigation cache; failed mutation never claims success; old socket/token cleared; no privileged file URL disclosed; account deletion clears stored identity and private client artifacts. All high/critical findings fixed before store submission.
- **Tests/evidence:** Security checklist, focused negative integration tests, redacted network capture, secure-storage inspection, dependency/vulnerability and app permission review, Android/iOS device confirmation.

### MOB-44 — Measured Board/network/list rendering and runtime performance stabilization

- **Type:** Performance engineering. **Dependencies:** MOB-15, MOB-17, MOB-22, MOB-28–31, MOB-35–36; coordinate backend/Web #233/#234 changes.
- **Implementation:** Record baseline on **production-like but non-production** controlled data with 0 / 100 / 101 / 250+ Cards, 1 / 10 / 30+ Columns, 0/100+ notifications and 100+ My Tasks. Profile cold/warm start, auth restore, Board page traffic, route navigation, horizontal/vertical scroll frame stability, app memory, battery-relevant socket behavior, image load and large Board filtering. Compare before/after on same device/network fixture.
- **Optimization boundary:** Apply targeted React Native list virtualization, memoization, query dedupe, lazy mounting, bounded pagination and image caching only when measured. Never hide Cards, lose ordering, incorrectly parallelize OFFSET or weaken ACL/realtime freshness to improve apparent speed.
- **Acceptance:** Significant measured bottlenecks addressed or explicitly deferred with proof they are not release blockers; no unbounded fetch loops or duplicate mutation + Socket refetch; smooth scrolling for representative data and bounded memory when opening many Cards. Numeric budgets should be **set after baseline and device class selection**, not invented here.
- **Tests/evidence:** Request waterfall, transfer bytes, query count, TTI/navigation/scroll measurements, before/after comparison, regression for Card ordering/permission under optimized fetching, low-memory Android + iPhone device evidence.

### MOB-45 — Visual fidelity, accessibility, localization-safe copy and responsive QA

- **Type:** Product-quality acceptance. **Dependencies:** MOB-02–03 and all implemented screens MOB-08–41.
- **Implementation:** Audit every approved screen against its reference and Design Spec; verify genuine logo, typography, spacing, controls, 4 tabs, safe areas, bottom-sheet geometry, keyboard behaviors, light/dark/system, text scaling, touch hit areas, screen-reader semantics, predictable Back and gestures. Audit supplemental parity screens (Workspace management, Table, members, archive, Settings) to share the same design system even though they lack hero mockups.
- **Copy/data:** Labels reflect real API semantics; no “Completed” group/fictional quiet-hours, time blocks, Bio, 2FA, language switch or push toggle unless source-backed or specifically approved. Use semantic color (error, due, success), not color-only status; truncate content accessibly.
- **Acceptance:** No meaningful unapproved deviation from the ten owner-approved groups; no clipping/overlap with dynamic type/keyboard/status areas; TalkBack/VoiceOver can reach all meaningful controls; horizontal Board gestures and drag alternatives usable without precision gestures; dark mode is legible.
- **Tests/evidence:** Matched screenshot set for representative Android/iPhone viewport, narrow/large phone and large-font cases; accessibility checklist and screen-reader/manual verification, Android back/gesture QA, design variance ledger signed off.

### MOB-46 — EAS signing, build pipelines, App/Universal Links and internal distribution

- **Type:** Native release engineering. **Dependencies:** MOB-07, MOB-03, MOB-09, MOB-43–45. **Architecture:** §14.
- **Implementation:** Finalize Expo config with unique Android applicationId/iOS bundle identifier, K adaptive/app icons, splash assets, display name, app scheme, entitlements/permissions and `development/preview/production` EAS profiles. Create protected, environment-isolated build/signing credentials. Configure native HTTPS App Links/Universal Links on `kanvexa.tech` with validated Android/iOS association files and Google/email/invitation handoffs; ensure no production DNS change without review.
- **Pipelines:** Dedicated path/approval-aware native workflow(s): lint/test/typecheck → internal Android and iOS build → install and smoke → manual release approval. Keep Web CI/CD and EC2 production deploy independent. If EAS Update is used, define compatible native runtime/version policy, channel separation and rollback; do not bypass store-safe native changes.
- **Acceptance:** Signed internal builds install on tested Android and iOS hardware, connect to intended environment, open trusted email/Board/Card links and display correct branding/permissions. Web-only PRs do not trigger redundant native cloud builds; no sensitive signing material is committed.
- **Tests/evidence:** Reproducible build and device install instructions, build IDs, Android/iOS signing verification, app link intent/universal-link tests, failed update rollback exercise and environment configuration audit.
- **Gate:** Apple/Google accounts, platform signing, domain file publication and app identifiers require owner/operator action; do not claim store readiness without them.

### MOB-47 — Release candidate, store submissions, staged launch and production verification

- **Type:** Final release. **Dependencies:** MOB-42–46 and _all required feature issues_ with approved exceptions closed.
- **Implementation:** Freeze reviewed release candidate and version/changelog; finalize icons/screenshots/store descriptions/support/contact/privacy policy terms, app permissions and data safety/disclosure questionnaires based on actual included SDKs/data behavior. Run a controlled end-to-end sanity test against **authorized production** only when approved. Distribute to internal Android testers / TestFlight as appropriate, triage crashes/issues, then submit to Google Play/App Store with manual approval and monitored staged rollout where supported.
- **Rollback/recovery:** Document app store release halt/staged rollout stop, compatible OTA rollback if used, backend version interop and breaking API mitigation. App clients cannot be forcibly updated instantly; server changes must tolerate supported mobile versions or enforce an explicit min-version policy.
- **Acceptance:** All critical/high defects closed; production-like and release smoke test report completed; app listing/privacy docs accurate; authorized owner approves submission; successful install/login/Board edit/realtime/download on supported Android/iOS; post-release telemetry privacy and incident contact documented.
- **Tests/evidence:** Signed build provenance, issue closure list, release checklist, deployment approval evidence, production smoke results, App/Play review outcomes, first-release monitoring log and roll-forward/rollback procedure.
- **Boundary:** No implied auto-publish or production mutation merely because issue code is marked `done`. External store review timing is not a deterministic development estimate.

**P7 completion check:** QA matrix green → Security/perf/a11y accepted → Android/iOS signed builds tested → owner approves release candidate → controlled store release and production verification. Kanvexa Mobile is complete only when the approved full feature set and both supported platform release gates are satisfied.

---

## 11. Cross-phase engineering standards (mandatory for each feature PR)

### 11.1 Architecture / repository discipline

- New native UI/business adapter code belongs in `apps/mobile/src/...` or the version-correct Expo Router structure; shared **pure** types/enums/helpers belong in `packages/shared` only after proving cross-platform compatibility. Do not move backend entities/TypeORM or DOM components into shared.
- Run existing root install/lint/test/build/format and infra checks after dependency/script modifications; use scoped tests for UI issue iteration and a final full run before PR. Existing CI remains a quality gate; mobile should add focused coverage without doubling redundant checks.
- Keep API base URL/Socket origin consistent and configurable. Physical device/emulator cannot always use `localhost` to reach a computer-hosted NestJS server. Public Expo config values must contain no secrets.
- Design components have central tokens and shared primitives; feature screens cannot fork their own button/field/sheet styling to approximate mockups.
- Navigation by stable typed IDs. A Web permalink is a link target, **not** a permission grant; server checks each read/action.

### 11.2 REST/realtime data contract discipline

- Consume the existing success envelope and DTO allowlists; validate input at boundaries. Handle raw binary exports/private files distinctly, `204` empty, cancel, invalid JSON, offline, rate limiting and `401/403/404/409` without blank-screen crashes.
- Cache keys include user/session generation and resource/filter identity; stale late responses must never render after logout/account switch or permission loss.
- Mutation optimistic UI must be reversible and reconciled with authoritative response; Board reorders/comments/checklist updates require concurrency tests and targeted invalidation. Do not clear all Board lists on every irrelevant socket hint.
- **Access:** Server grant is always authoritative. Workspace ADMIN is not automatically explicit Board OWNER, guest Board access is not Team Workspace membership, and an archived Card/Board is never silently writable.
- **Dates:** API instants and selected IANA timezone are distinct; render date labels from valid instants and use backend expected serialization, not naïve local dates.
- **Native AppState:** Foreground triggers appropriate refresh; background does not promise persistent Socket.IO or hide transport errors from the user.

### 11.3 Reusable per-screen state checklist

For **every** screen/section, implement and test:

- [ ] Initial loading/skeleton (no unintended layout shift).
- [ ] Empty collection / empty filters, with working next action.
- [ ] Network failure + Retry, including partial sectional failure.
- [ ] Offline/foreground reconnect and stale-cache behavior **only where privacy-safe**.
- [ ] 401/auth expired and cross-account cache purge.
- [ ] 403/404 revoke/unavailable/archived state with no protected data flash.
- [ ] 409 conflict and 429 rate limit where writes exist.
- [ ] Pending mutation, double tap, cancellation, rollback and draft preservation.
- [ ] Long text, unknown avatar/image, large font, portrait and keyboard insets.
- [ ] Screen reader, focus, clear button labels and minimum touch target.
- [ ] Android hardware Back and iOS navigation/sheet dismiss.
- [ ] Correct role-based visibility and server validation regardless of UI.

### 11.4 Definition of Ready (DoR) — before an implementation issue starts

- [ ] Latest `main` + relevant issue/optimization merges checked; no blind reliance on old audit report.
- [ ] Correct mockup asset and Design Spec section linked; UI deviation risk explicitly noted.
- [ ] Backend controller/DTO/service/test and relevant Web component/hook located.
- [ ] Dependencies complete or a safe interface mock/branch integration plan exists.
- [ ] Current roles, query params, pagination rules, response errors and feature flags confirmed.
- [ ] Any capability gap has a documented decision path (D-01–D-14) and no fake control.
- [ ] Feature scope reasonably fits a coherent PR; if too large, split within the same phase without inventing a new product tier.
- [ ] Test fixtures and acceptance checks are reproducible on local/staging.

### 11.5 Definition of Done (DoD) — before merge

- [ ] Functionality matches Web behavior and owner-approved mobile screen, or a signed variance.
- [ ] No unrelated Web UI, backend schema or production config regressions.
- [ ] Unit/component tests plus relevant backend/real-DB/socket/native-device tests pass.
- [ ] Permission matrix and destructive/security edge cases checked.
- [ ] Protected response caching, logout/revocation and error state safe.
- [ ] Real implementation not dummy data/dead buttons; no unsupported source API in client.
- [ ] Visual comparison includes device capture and no material clipped/overcrowded area.
- [ ] Accessibility, keyboard, dark mode and native Back verified for the feature.
- [ ] Relevant docs/contract notes updated, unused feature flags/dependencies removed.
- [ ] Code is formatted/linted/typed; meaningful commits + clean tree; concise PR handoff lists behavior, tests, risks and screenshots only as needed.
- [ ] No push/PR/merge/deploy or external credential action occurred without approval.

---

## 12. Test matrix and high-risk release journeys

### 12.1 Roles / access matrix

| Identity/context                   | Must verify in relevant issues                                             | Primary owner issues   |
| ---------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| Signed-out / unverified            | Auth, email verification and protected-route gate                          | MOB-03, 05, 08         |
| Personal Workspace owner           | Provisioning, Board defaults, create/list, removal restrictions            | MOB-11–14              |
| Team Workspace ADMIN               | Workspace member/policy actions; **not** automatic private Board ownership | MOB-12, 23–25          |
| Team Workspace MEMBER              | Member actions; read/write based on Board capability                       | MOB-11–15, 23–25       |
| Explicit Board OWNER               | Board settings/member operations, authorized export                        | MOB-14–15, 25, 40      |
| Explicit Board MEMBER              | Card operations where allowed; no OWNER-only export                        | MOB-15–22, 25, 40      |
| Guest Board OWNER/MEMBER           | Board-scoped rights without false Workspace membership                     | MOB-11, 14, 23, 25, 40 |
| Workspace viewer, not Board member | Private Board/Cards inaccessible; safe status in lists/search              | MOB-11, 15, 29–31      |
| Removed/revoked mid-session        | Immediate protected-data clearance and denied mutations                    | MOB-05–06, 23–28, 43   |
| Archived Board/Card                | Read-only data and source-verified restore/export exceptions               | MOB-14–22, 40          |
| Account being deleted              | Blocker workflow, auth/session cleanup, no stale cached PII                | MOB-41, 43             |

### 12.2 Real cross-platform workflows (minimum release suite)

| Journey                      | End-to-end steps                                                  | Must prove                                                        |
| ---------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| J-01 Identity                | Register → verify email → login → close/reopen app → logout       | Correct verification and fixed-lifetime session, no private flash |
| J-02 Google                  | Google sign-in → Kanvexa JWT → link provider → sign out           | Native audience/security, no account mixing                       |
| J-03 First Workspace         | Discover Personal → create Team → rename → create Board           | Same data as Web, valid Personal/Team ownership                   |
| J-04 Workspace collaboration | Invite → accept via app link → change role → leave/revoke         | Proof safety, correct permissions and cache cleanup               |
| J-05 Board lifecycle         | Create/star/background → visibility/move → archive/restore        | Role-gated mutations, stable Board identity                       |
| J-06 Kanban                  | Create Columns + Cards → reorder/move → duplicate/archive/restore | Correct ordering and copied fields, Web sync                      |
| J-07 Card metadata           | Edit due/start, assignees, labels and description                 | UTC/timezone correctness, draft safety, no phantom priority       |
| J-08 Card rich content       | Checklist rapid toggles → mention comment → URL/file attachment   | Concurrency and private file security                             |
| J-09 Views                   | Board Kanban → Table → Calendar Month → Week → Card               | Same dataset and supported filters/due dates                      |
| J-10 Productivity            | Home → My Tasks filters → Global Search → Card                    | Server counts, pagination and access-safe deep links              |
| J-11 Inbox                   | Web assignment/mention → mobile unread → read-one/read-all        | Notification privacy and count reconciliation                     |
| J-12 Push (if approved)      | Grant/deny push → receive → tap → revoke/logout                   | Best-effort delivery, no private payload or stale token           |
| J-13 Security                | Change password → old socket dies → token expiry → re-login       | Secure storage and session boundary                               |
| J-14 Data                    | OWNER Board export / non-OWNER deny → account export              | Correct raw bytes, no leaked protected file                       |
| J-15 Deletion                | Blocked delete → correct blockers → confirmed deletion            | Erasure semantics, no access on restart                           |
| J-16 Resilience              | Lose network during move/upload → restore, resume, retry          | No false success, data consistency, no duplicate writes           |
| J-17 Accessibility           | TalkBack/VoiceOver + large font + keyboard/back + dark theme      | All primary actions reachable/understandable                      |
| J-18 Large Board             | 0/100/101/250+ Cards, many Columns, multi-device updates          | No hidden data, order drift, unbounded waterfalls                 |

### 12.3 Environment, platform and evidence rules

- Minimum: Android emulator + **at least one physical Android device**; iOS simulator and physical iPhone/TestFlight build **when Apple tooling/credentials are available**, with real device sign-in, files, links and push where relevant.
- Keep separate test/staging/prod identifiers and config; never use real production accounts or private files in automated fixtures. Explicitly identify mocked results versus real server integration, and source-only audit versus deployed production state.
- Preserve test determinism: fake clock for dates/session, seeded DB for roles/Boards, controlled Socket.IO connectivity, untrusted link fixtures and HTTP replay/mocking without exposing credentials.
- Performance claims require measured before/after environment and dataset; QA sign-off must list unavailable device configurations as exceptions rather than silently marking them tested.

---

## 13. Issue index, prerequisite map and sensible integration boundaries

### 13.1 Full issue index (planning IDs only)

| ID     | Phase | Short title                             | Main prerequisites / integration gate        |
| ------ | ----- | --------------------------------------- | -------------------------------------------- |
| MOB-01 | P1    | Expo/pnpm bootstrap                     | None                                         |
| MOB-02 | P1    | Native design system                    | 01                                           |
| MOB-03 | P1    | Navigation/deep link route skeleton     | 01, 02; session integration 05               |
| MOB-04 | P1    | API/query transport                     | 01                                           |
| MOB-05 | P1    | Secure native session                   | 03, 04                                       |
| MOB-06 | P1    | Socket/reconnect/access layer           | 04, 05                                       |
| MOB-07 | P1    | Testing/CI/EAS scaffolding              | 01, 04                                       |
| MOB-08 | P2    | Email/password Auth + recovery          | 02–05                                        |
| MOB-09 | P2    | Google native OAuth                     | 05, 08; D-02                                 |
| MOB-10 | P2    | Home dashboard                          | 02–05, 08                                    |
| MOB-11 | P2    | Workspace discovery/switch              | 03–05, 08                                    |
| MOB-12 | P2    | Workspace create/edit/overview          | 11                                           |
| MOB-13 | P2    | Boards directory/star/background/create | 11, 12                                       |
| MOB-14 | P2    | Board lifecycle/privileged settings     | 12, 13                                       |
| MOB-15 | P3    | Board Kanban shell/loading/filters      | 06, 13, 14; merged #233/#234 review          |
| MOB-16 | P3    | Column management                       | 15                                           |
| MOB-17 | P3    | Card lifecycle + reordering             | 15, 16                                       |
| MOB-18 | P3    | Full Card Detail + description          | 17                                           |
| MOB-19 | P3    | Labels/assignees/dates                  | 18                                           |
| MOB-20 | P3    | Checklists                              | 18                                           |
| MOB-21 | P3    | URL/private attachments                 | 18, 04/05; D-10                              |
| MOB-22 | P3    | Table View                              | 15, 17, 19                                   |
| MOB-23 | P4    | Workspace members/guests/policies       | 12, 05                                       |
| MOB-24 | P4    | Workspace invitations                   | 23, 08, 03                                   |
| MOB-25 | P4    | Board membership/roles                  | 14, 15, 23                                   |
| MOB-26 | P4    | Comments and @mentions                  | 18, 25                                       |
| MOB-27 | P4    | Activity history                        | 12, 14, 25                                   |
| MOB-28 | P4    | Presence/concurrency/revocation         | 06, 17, 23–27                                |
| MOB-29 | P5    | My Tasks                                | 10, 17; D-04                                 |
| MOB-30 | P5    | Global Search                           | 03–05, 11, 18; D-03                          |
| MOB-31 | P5    | Inbox/read/unread                       | 03–06                                        |
| MOB-32 | P5    | Notification Preferences                | 31                                           |
| MOB-33 | P5    | Native push (capability gate)           | 03–06, 31, 32; D-06                          |
| MOB-34 | P5    | Quiet hours (capability gate)           | 32, 33 if included; D-07                     |
| MOB-35 | P5    | Calendar Month                          | 15, 18, 19; D-05                             |
| MOB-36 | P5    | Calendar Week                           | 35                                           |
| MOB-37 | P6    | Profile/avatar/email change             | 05, 08, 09; D-09/D-14                        |
| MOB-38 | P6    | Appearance/preferences                  | 02, 04, 05                                   |
| MOB-39 | P6    | Security/password/linked accounts       | 05, 08, 09; D-08                             |
| MOB-40 | P6    | Account/Board export                    | 05, 14, 21                                   |
| MOB-41 | P6    | Data & Privacy/delete/Settings shell    | 32, 37–40                                    |
| MOB-42 | P7    | End-to-end parity matrix                | Functional issues & decisions complete       |
| MOB-43 | P7    | Security/privacy/resilience             | Security-sensitive features complete         |
| MOB-44 | P7    | Performance/reliability                 | Board/Productivity views + realtime complete |
| MOB-45 | P7    | Design/accessibility/device QA          | All screen implementations complete          |
| MOB-46 | P7    | Signed EAS internal builds/app links    | 07, 43–45                                    |
| MOB-47 | P7    | Store release/verification              | 42–46 + owner approval                       |

### 13.2 Integration ordering — avoids unnecessary team blocking

This section explains dependency-safe possibilities; **it does not assign people**:

- After **MOB-01**, design tokens (02), typed transport (04) and testing setup (07) can progress largely independently, with a narrow coordinated API between them.
- After API/auth foundation, Authentication (08), Home (10), Workspace discovery (11) and Appearance (38) can proceed in separate feature directories if navigation and query-key contracts are stable.
- Board backend/UX tasks require a single agreed Board contract before multiple developers edit Card list/query and socket invalidation logic. Keep one integration owner for overlapping files when actual team allocation happens.
- In P3, Card Detail shell (18) is the integration surface for separate assignees/labels/dates (19), checklists (20), attachments (21) and comments (26). Merge the screen contracts before feature modules are mounted, not by multiple concurrent rewrites of the same file.
- Board membership (25) and Workspace invitations (24) can proceed after their separate foundations; realtime cross-device hardening (28) follows their integration.
- My Tasks (29), Search (30), Inbox (31) and Calendar (35) are mostly independent product features after stable API/session/Board routing. Push/quiet-hours (33–34) should not block development of the working in-app Inbox.
- QA can add tests alongside the corresponding features, even though formal closure MOB-42–45 is late. Waiting until P7 to write any tests is **not** acceptable.

### 13.3 Expected directory boundaries (proposed, adapt to actual Expo Router conventions)

```text
apps/mobile/
  app/                         # Expo Router routes and layout guards
  src/
    app/                       # providers, session bootstrap, navigation adapters
    components/                # shared native UI primitives
    design/                    # tokens, themes, typography, official assets
    lib/
      api/                     # typed client, errors, raw file transport
      auth/                    # SecureStore/session ownership
      realtime/                # socket lifecycle and invalidation coordination
      navigation/              # link parser + typed route builder
      files/                   # pickers, secure temp files, upload/download
    features/
      auth/
      home/
      workspaces/
      boards/
      columns/
      cards/
      comments/
      attachments/
      tasks/
      search/
      notifications/
      calendar/
      settings/
    test/                      # fixtures, mocks, integration helpers
  assets/                      # approved K logo, icons, splash and presets
  app.config.ts
  eas.json
  package.json
packages/shared/                 # existing verified cross-platform contracts
apps/backend/                   # current server remains authoritative
apps/frontend/                  # existing Web UI remains protected from redesign
```

Feature folder names are organizational suggestions, not a demand to duplicate a backend module per route or split shared contracts unnecessarily. The actual app route tree must follow the installed Expo Router release.

---

## 14. How to turn this document into GitHub milestones/issues later

**Do this when ready to begin implementation, not now.** Do not assign an owner in advance. The stable `MOB-XX` codes intentionally survive GitHub numbering changes.

1. Check current `main`, latest merged Web Phase 5/optimization work, new API features and release tags. Update this roadmap's baseline if a parity item changed; do **not** re-divide the product into MVP/Post-MVP.
2. Commit/copy Design Spec, Architecture and approved image pack into an agreed docs/assets path in the Kanvexa repo. Images should retain exact screen IDs (`01...10`) and the authentic user-supplied K logo. Keep binary size/repo performance in mind and avoid redundant duplicate exports.
3. Define **seven optional GitHub milestones** matching P1–P7, with no dates unless the team later decides. Milestone titles are engineering groupings, **not seven separate consumer releases**.
4. Create each issue from its `### MOB-XX` section plus global DoR/DoD and references. Preserve `MOB-XX` in issue title/body and add explicit `Depends on MOB-YY` lines. Do not invent concrete GitHub `#NNN` before issue creation.
5. Apply existing project labels if available; avoid creating many duplicate semantic labels. Suggested categories are `mobile`, `frontend`, `backend`, `infra`, `security`, `performance`, `design`, `testing`, `release` and `phase:P1..P7` only if the repository's conventions make them useful.
6. Keep `assignee = unassigned/TBD` until the actual team decides. Then assign from dependency-safe workstreams, not rigidly by equal issue count; scope and conflict risk differ.
7. Before starting each issue, request a Codex implementation brief containing **branch name, scope, endpoints/files, design reference, tests, 7–8 meaningful commit plan where appropriate, and explicit no-push/no-PR/no-deploy boundary**.
8. Use Pull Requests to show implementation evidence (tests, screen capture, compatibility/risks), keep PR description short and traceable to the detailed issue. Merge only after feature and Web regressions pass.
9. Update issue status/decision log after each implementation. A green CI without device/auth/permission verification does **not** close a security/native integration issue.
10. At the release gate, compile issue closures, variance ledger, test matrix and Android/iOS signed build evidence into one auditable launch checklist.

### 14.1 GitHub issue body handoff template

```md
# MOB-XX — <precise title>

Phase: P# — <engineering phase>
Owner: Unassigned
Source: KANVEXA_MOBILE_ROADMAP.md §<issue>
Visual reference: Design Spec §<screen>, assets/<approved image>
Architecture reference: Architecture §<section>
Dependencies: MOB-.. (and any API decision gate D-..)

## Goal

<user-visible result; same Kanvexa account/back-end data as Web>

## In scope

<copy/reconcile detailed bullets from the roadmap issue>

## Explicit exclusions

<mockup-only and unrelated backend/UI changes prohibited>

## Current API contract

<verified current source paths, request/query/response, roles, errors>

## Implementation sequence

<small coherent tasks with files/modules boundary>

## Acceptance criteria

- [ ] Functional + visual behavior
- [ ] Role/archived/revoke/access correctness
- [ ] Loading/error/offline/concurrency
- [ ] Android + iOS native-specific behavior as relevant
- [ ] Automated and manual verification
- [ ] No Web/production regression

## Testing / documentation

<commands, fixtures, screenshot comparisons, variance resolution>

## Agent working constraints

Read AGENTS.md and latest source first. Implement only scoped changes.
Use the team's meaningful-commit convention, commit your changes when instructed.
Do not push, create PR, merge, deploy, touch production or ship app-store builds
without separate owner authorization.
```

---

## 15. Final readiness and release sign-off checklist

### Product completeness

- [ ] All current Web business features listed in §1.2 have a genuine mobile path or a documented, owner-approved platform exception.
- [ ] All ten approved visual groups implemented with the true Kanvexa logo and only supported controls; Table/Workspace/membership supplemental screens included.
- [ ] Android and iOS use the same accounts, Workspaces, Boards, Cards, notification records and security grants as Web.
- [ ] No test fixture/card label/content is hardcoded as product state; no dangling tap controls or “coming soon” placeholders on supported parity features.

### Data security and correctness

- [ ] Identity recovery, expiry, account switching and password/security invalidation never leak prior protected state.
- [ ] Owner/member/guest/Workspace-reader/archived/revoked role matrix passes on actual server.
- [ ] Card moves/reorder/checklists/comments remain correct under concurrent Web/mobile edits and reconnect.
- [ ] Private attachments and authorized exports do not disclose files via public URLs or leave sensitive app temp content unnecessarily.
- [ ] User notification content and push (if included) respect preferences, privacy, login state and access revocation.

### Engineering quality

- [ ] Mobile development setup/CI deterministic, root Web CI/CD preserved, dependency/security reviews complete.
- [ ] Normal/large Board performance measured and optimized without data omissions; no uncontrolled redundant network waterfall.
- [ ] Empty/error/offline/rate-limit states, keyboard, safe areas, dark mode, large text, TalkBack and VoiceOver have verification evidence.
- [ ] No unresolved high/critical security, data integrity or core-crash issue.

### Native release

- [ ] Android and iOS signing identities/permissions/App Links validated on real installed builds.
- [ ] Google native OAuth, email proofs, invitation links, Card deep links, file pick/share and real notification delivery (if included) tested on devices.
- [ ] Privacy/legal/store metadata accurately describes current data handling and SDK behavior.
- [ ] Owner authorizes production configuration changes, release candidate and app-store submissions separately.
- [ ] Monitoring, support, version compatibility, rollback/staged-release response and post-release smoke checklist are documented.

**Completion rule:** Close the whole Kanvexa Mobile roadmap only when the complete application and its Android/iOS release gates are satisfied. **There is no Mobile MVP/Post-MVP split.**

---

## 16. Source and documentation reference register

**Project documents required before implementation:**

- `KANVEXA_MOBILE_DESIGN_SPEC.md` + `KANVEXA_MOBILE_DESIGN_PACK.zip` (10 approved image groups and `assets/kanvexa-logo-v1.png`).
- `KANVEXA_MOBILE_ARCHITECTURE.md` (read-only source audit, integration and 12 risks).
- Repo [`AGENTS.md`](https://github.com/duongkienvn/SE2026-T13/blob/main/AGENTS.md), [Web/backend architecture](https://github.com/duongkienvn/SE2026-T13/tree/main/docs/architecture), [Web design reference docs](https://github.com/duongkienvn/SE2026-T13/tree/main/docs/design), relevant source service/DTO files.

**Concrete endpoint/code anchors (verified by prior source audit, revisit `main` when issue starts):**

- Monorepo [`package.json`](https://github.com/duongkienvn/SE2026-T13/blob/main/package.json), [`pnpm-workspace.yaml`](https://github.com/duongkienvn/SE2026-T13/blob/main/pnpm-workspace.yaml), [`packages/shared/package.json`](https://github.com/duongkienvn/SE2026-T13/blob/main/packages/shared/package.json).
- Auth [`auth.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/auth/auth.controller.ts), [`google-auth.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/auth/google-auth.controller.ts), [`password-security.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/auth/password-security.controller.ts).
- Workspace [`workspace-api.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/workspaces/workspace-api.controller.ts), [`workspace-members.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/workspaces/workspace-members.controller.ts), [`workspace-invitations.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/workspaces/workspace-invitations.controller.ts).
- Board/Card [`boards.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/boards/boards.controller.ts), [`columns.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/columns/columns.controller.ts), [`cards.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/cards/cards.controller.ts), [`card-checklists.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/cards/card-checklists.controller.ts), [`card-attachments.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/cards/card-attachments.controller.ts).
- Productivity [`productivity.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/productivity/productivity.controller.ts), [`search.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/search/search.controller.ts), [`notifications.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/notifications/notifications.controller.ts), [`notification-preferences.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/notifications/notification-preferences.controller.ts).
- Privacy [`exports.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/exports/exports.controller.ts), [`account-deletion.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/users/account-deletion/account-deletion.controller.ts), [`avatar.controller.ts`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/backend/src/api/users/avatars/avatar.controller.ts).
- Web reference [`BoardViews.tsx`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/frontend/src/features/boards/components/BoardViews.tsx), [`CalendarBoard.tsx`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/frontend/src/features/boards/components/CalendarBoard.tsx), [`AuthProvider.tsx`](https://github.com/duongkienvn/SE2026-T13/blob/main/apps/frontend/src/features/auth/AuthProvider.tsx), [`.github/workflows/ci.yml`](https://github.com/duongkienvn/SE2026-T13/blob/main/.github/workflows/ci.yml).
- Official Expo docs: [Monorepos](https://docs.expo.dev/guides/monorepos/), [Expo Router](https://docs.expo.dev/router/introduction/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Push notification setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [EAS Build](https://docs.expo.dev/build/introduction/).

**Change discipline:** If later Web functionality changes, update the affected `MOB-XX` requirements and parity matrix from verified source. Do not replace this roadmap with an unrelated second MVP/Post-MVP plan, and do not assign work until the team is actually ready.

---

_End of `KANVEXA_MOBILE_ROADMAP.md` — 47 proposed issues across 7 implementation phases; no assignments or artificial product release split._
