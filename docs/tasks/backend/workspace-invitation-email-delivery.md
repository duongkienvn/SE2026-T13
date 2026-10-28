# P2-10 — Workspace invitation email delivery

Local implementation for [#119](https://github.com/duongkienvn/SE2026-T13/issues/119),
based on fetched `main` containing P2-03 / PR #126. This is source and local QA
evidence, not a deployed feature or verified inbox delivery. Scope follows
[WS-02](../../roadmap/post-mvp.md), the
[access model](../../design/product-ux-blueprint.md#3-workspace-domain-and-migration-decisions)
and [P2-03 lifecycle](workspace-members-invitations-api.md).

## Mail integration and security

`WorkspaceApiModule` imports the existing `MailModule`, which implements the
existing `WorkspaceInvitationMailer` port. No entity, migration, permission,
issuance/rotation policy, dependency, queue, outbox or frontend page was added.

- With a configured acceptance path, the validated `MAIL_TRANSPORT` selects
  `FakeWorkspaceInvitationMailer` or `ResendWorkspaceInvitationMailer` through
  Nest DI. Development may explicitly select Resend; production requires it.
  `NODE_ENV=test` forces Fake even when the input asks for Resend.
- Without a path the provider is undefined, preserving P2-03's optional-port
  `UNAVAILABLE` outcome. An invitation is still reserved and subject to existing
  quotas/cooldown; there is no mail, and its discarded proof cannot be recovered.
  Enable the destination first, then reinvite after cooldown.
- Fake uses the same rendering path and keeps at most 20 rendered deliveries in
  process memory, deduplicating retained idempotency keys like FakeWelcomeMailer.
  Fake `SENT` means a simulation. Restart clears captures; there is no debug HTTP
  endpoint, logging or disk spool. Treat those in-memory links as secrets.
- Resend uses `MAIL_FROM`, the normalized domain-provided recipient, branded
  HTML/text, `workspace-invitation/<invitationId>` and the existing 10-second
  `AbortSignal.timeout` convention. It makes one SDK call, with no automatic
  retry. P2-03 retains its independent 30-second dispatch bound.
- Only explicit acceptance with a provider message ID gives `SENT`; it is not an
  inbox-arrival guarantee. Rendering failure before I/O and explicit 4xx
  rejection (including 429) give `FAILED`. HTTP 408/409, 5xx, missing acceptance
  ID, SDK/network errors and timeout give `UNKNOWN`. A 409 may represent an
  in-flight idempotent request, so it is conservatively uncertain.
- The installed Resend SDK logs raw provider error bodies outside production
  through a private `logError` hook and has no public logger option. The
  invitation adapter silences that hook on its dedicated client only. Real-SDK
  tests intercept fetch and assert no console output even when a rejection
  echoes a proof. This version-specific seam must be retested on SDK upgrades.
  Existing auth mail adapters are unchanged.
- The domain commits its reservation before calling the adapter and conditionally
  records completion afterward. Only SHA-256 proof hashes reach PostgreSQL;
  payloads, URLs, SDK errors and raw proofs are neither logged nor returned by
  this integration. Revoke/removal/rotation/expiry defeat late completion.
  `FAILED`/`UNKNOWN` cannot be accepted; reinvite rotates instead of retrying the
  old proof. Existing cooldown, lease, rate limits and single-use checks apply.

## Destination contract and default-off rollout gate

`WORKSPACE_INVITATION_ACCEPT_PATH` defaults to empty in both environment examples
and Compose. Empty leaves invitation delivery `UNAVAILABLE`, independently of
working verification, recovery and welcome mail. A nonempty value must be a
root-relative path of plain path segments, without origin, query, fragment,
encoded separators, dot segments or backslashes. There is no built-in acceptance
route and no request-body/Host-header override.

The link format supplied for P2-08 integration is:

```text
<validated PUBLIC_APP_URL><agreed acceptance path>#proof=<43-character base64url proof>
```

This uses the exact validated application origin (HTTPS in production, HTTP
loopback permitted outside production). The fragment stays out of ordinary HTTP
access logs and referrers. It still requires safe handling by the browser and
mail provider. No invitation IDs, email or Workspace IDs are added to the URL.

At implementation time #117 and its comments contain no agreed concrete route;
the current frontend router has no acceptance screen. `/qa/invitation` and
`/qa/invite` in tests/previews are synthetic destinations only. This record is a
handoff proposal, not evidence of agreement with #117's owner. Keep the runtime
path empty until the owner confirms the path and fragment contract and the
destination actually works. Do not substitute the illustrative query-token path
from the issue or point email at Overview/login as a pretend acceptance flow.

P2-08 must extract and clear the fragment immediately, keep proof only in
ephemeral memory across sign-in/register/verification/account switching, avoid
storage/analytics/referrer leaks, and submit it only in the authenticated accept
body. Opening a link must never mutate membership. Matching verified identity
and explicit acceptance remain mandatory. Expired, revoked, reused and wrong-user
proofs receive the same generic invalid-invitation response.

Before enabling live mail:

1. Merge/deploy and verify #117's agreed destination, deep-link routing, fragment
   cleanup and auth/account-switch behavior. Verify #112's migrations through
   their separately authorized release process; this change adds no migration.
2. In Fake mode on a designated local/test backend, configure only the agreed
   path and exercise ADMIN issue → one captured email → verified recipient
   acceptance → one membership. Cover revoke, replay, expired/mismatched identity,
   failed/uncertain delivery and reinvite.
3. Check verified `kanvexa.tech` sender, `MAIL_FROM`, Resend key, HTTPS
   `PUBLIC_APP_URL` and the versioned public logo. Disable provider open/click
   tracking for these transactional links; do not rewrite proofs through tracking
   destinations. No DNS/provider/credential changes were made here.
4. Obtain separate approval and a designated mailbox for the first real send.
   Check actual Gmail desktop/mobile and Outlook plus text fallback, links and
   provider acceptance. Browser QA below does not prove email-client rendering.
5. Enable the path in the protected backend environment only after those gates.
   Observe safe invitation `sendState`/terminal status through authorized APIs;
   do not dump payloads or proofs. Provider outage has no background replay.
   Reinvite after cooldown instead of resetting state or reusing proof.

Rollback: clear the path and restart the backend to stop new invitation email;
other mail continues. Existing sent invitations retain P2-03's expiry/revocation
rules. No data rollback or schema removal is needed.

## Email preview and visual QA

Run `pnpm --filter @kanban/backend preview:workspace-invitation-email`. It builds
and writes synthetic HTML/text under `.codex/previews/workspace-invitation-email/`
without bootstrapping the app, reading `.env`, connecting to DB or constructing a
mail client. The known fake proof and addresses are QA-only. The preview uses a
local copy of the production logo; delivered mail uses the token-free first-party
versioned logo URL. Read `invitation.txt` for the text fallback.

The template matches Welcome Email typography, spacing, 600px table layout,
Kanvexa logo/wordmark, `#615CF7`, inline styles and optional dark-mode media rules.
It includes Workspace name, recipient, Member role, Join Workspace CTA, exact UTC
expiry, matching fallback link and concise safety footer. It claims membership
only after accepting. All dynamic HTML is escaped; the subject is stable to keep
Workspace names out of mail headers. Long Unicode names/emails and links wrap.

Exactly four successful representative Chrome screenshots were inspected:

| Scenario                                                       | Observation                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 900px desktop, light                                           | Logo, hierarchy, CTA, expiry and fallback readable; no horizontal overflow; local assets load; no console/network errors |
| 320px narrow layout, long Unicode/unbroken name and long email | Name/address/link wrap, CTA remains usable; no horizontal overflow                                                       |
| 390px mobile, dark                                             | Contrast, panel, CTA and expiry remain readable; 390px document width, 58px CTA height                                   |
| 900px desktop, images blocked                                  | Text wordmark, context and CTA remain understandable without the logo; no image request or console error                 |

Two archived screenshots:
[mobile dark](../../design/screens/implementation/workspace-invitation-email/mobile-dark.png),
[desktop images blocked](../../design/screens/implementation/workspace-invitation-email/desktop-images-blocked.png).
The other two were reviewed inline. Screenshots contain only synthetic data.
No repetitive screenshot analysis or real inbox send was performed.

## Frontend Soon/Unavailable audit and handoff

Audited `WorkspaceIdentity`, `WorkspaceSections`, `WorkspaceSummaryCards`,
`WorkspaceActivity`, Workspace navigation/toolbars, API gateways and `app/routes`.
The [existing API integration](../frontend/workspace-api-integration.md) already
activates discovery, Team creation, Overview, server-backed Boards, permitted
Board creation/archive/restore and switching. No remaining disabled control has
a complete ready route, form, API integration and authorization flow. Therefore
no frontend code or approved visual composition changed.

All paths below have `/api` prefix, JWT/session guards, normal success/error
envelopes, no-store reads and response allowlists. Pagination defaults to
`page=1,limit=20`, maximum `limit=100`; lists expose authorized `meta` totals.

| Existing control / owner    | Backend-ready contract                                                                                                                                                                                                             | Remaining UI work                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Members Soon / #117         | GET `/workspaces/:id/members?page&limit&search&role=ADMIN\|MEMBER` → `userId,displayName,avatarUrl,avatarRevision,role,joinedAt`; requires Workspace membership; no member emails or Board grants                                  | Real route/roster/search/paging, session-scoped cache and access-loss handling                                                                                    |
| Role/remove/leave / #117    | PATCH `/workspaces/:id/members/:userId` `{role:"ADMIN"\|"MEMBER"}` → 200 member; DELETE same → 204; POST `/workspaces/:id/leave` → 204                                                                                             | Team ADMIN management, confirmations, 409 self/last-admin protection; explicit Board grants persist; absent/unjoined Workspace is safe 404                        |
| Invite Soon / #117          | POST `/workspaces/:id/invitations` `{email,role?:"MEMBER"}` → 202 invitation; ADMIN and Team only; no ADMIN invite; GET same with `page,limit,status=PENDING\|ACCEPTED\|EXPIRED\|REVOKED` → history; DELETE `/:invitationId` → 204 | Dialog/list/revoke/reinvite and honest send state; 202 alone does not mean sent; repeated POST rotates after cooldown; no dedicated resend or decline endpoint    |
| Recipient acceptance / #117 | POST `/workspace-invitations/accept` `{proof}` → 200 member; 400 malformed, 401 auth/unverified guard, 409 unconfirmed delivery, generic 410 invalid/wrong identity, 429 throttled                                                 | Confirm destination/fragment contract, login/register/verify/account switch, explicit acceptance, replay/expiry/error states; do not enable live send until ready |
| Settings Soon / #118        | GET `/workspaces/:id` → Workspace DTO; PATCH same with nonempty subset `{name,description,icon}` → 200 Workspace, ADMIN only. Name 1–120, description nullable ≤2000; icon nullable `briefcase/users/code/palette/layers`          | Actual Settings route/form/permissions and conflict/access handling; metadata API is not policy or Danger Zone support                                            |
| Summary Unavailable         | Overview exposes ACL-filtered counts and `memberCount:number\|null`; existing UI already uses them. Board DTO has no member count                                                                                                  | Preserve null/Unavailable; do not invent counts or derive private membership                                                                                      |
| Guests / #117               | No authorized Guests projection endpoint exists                                                                                                                                                                                    | Remain unavailable; do not enumerate PRIVATE Board membership                                                                                                     |

Workspace response fields: `id,type,name,description,icon,role,canManage,
canCreateBoards,joinedAt,createdAt,updatedAt`. `canManage` describes ADMIN;
member mutations still require Team and their specific server checks. The
invitation DTO and full error/TTL/quota rules are in the
[P2-03 contract](workspace-members-invitations-api.md#http-contract). The frontend
must show terminal status before delivery state and clear protected caches on
logout/session change/403/404. Workspace ADMIN never grants PRIVATE Board access.

Workspace Activity, Starred, global Search, Notifications, WORKSPACE_VISIBLE,
policy controls and unsupported Danger Zone actions remain disabled. Board-scoped
Activity is not an authorized Workspace activity feed. No fake controls or data,
Guests directory, policy engine, Members page or Settings page was introduced.

## Verification evidence

Node 22.17.0, pnpm 10.18.3, local disposable Docker PostgreSQL only.

| Check                                                                                     | Result                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused link/template/Fake/Resend tests                                                   | PASS: 45 tests, including real SDK fetch interception for timeout and error logging                                                                                            |
| Real Nest selection plus existing verification/recovery/welcome and domain-dispatch tests | PASS: 5 suites / 83 tests; Fake/Resend in development/production and forced Fake in test                                                                                       |
| `pnpm --filter @kanban/backend test:workspace-members:database`                           | PASS: existing lifecycle/security/quotas/concurrency plus actual AppModule → rendered Fake email → hash-only DB → matching acceptance/replay and mocked Resend 429/503 handoff |
| `pnpm --filter @kanban/backend test:email-verification:database`                          | PASS: 16 checks, including database foundation regression                                                                                                                      |
| `pnpm --filter @kanban/backend exec node test/auth/password-security.integration.mjs`     | PASS: 16 PostgreSQL/HTTP/Socket.IO checks                                                                                                                                      |
| `pnpm --filter @kanban/backend exec node test/auth/welcome-email.integration.mjs`         | PASS: 15 PostgreSQL/HTTP checks                                                                                                                                                |
| `pnpm test` with process-local `VITEST_MAX_WORKERS=2`                                     | PASS: backend 67 suites / 680 tests; frontend 96 files / 876 tests; shared 7 tests                                                                                             |
| `pnpm build`                                                                              | PASS: all workspace packages                                                                                                                                                   |
| `pnpm test:infra`                                                                         | PASS: 18 tests, including gate-off Compose default and backend-only forwarding                                                                                                 |
| `pnpm lint`                                                                               | PASS                                                                                                                                                                           |
| Changed-file Prettier, local Markdown links and `git diff --check`                        | PASS: all intended files; 75 local link paths; clean diff                                                                                                                      |
| `pnpm format:check`                                                                       | FAIL: 729 untouched files; zero warnings overlap intended changes                                                                                                              |
| Real Gmail/Outlook delivery, #117 browser acceptance, CI/deployment                       | NOT RUN: requires completed destination and separately approved live send/release                                                                                              |

Initial unrestricted `pnpm test` overlapped database regressions and spawned 96
frontend workers; eight frontend assertions/timeouts failed. The full rerun with
two frontend workers passed without changing frontend code or timeouts. Do not
treat the initial failure as a proved product defect or a canonical green run.
An initial email-verification invocation via `pnpm exec node` reached its final
pnpm-context assertion and failed; the documented package-script rerun passed.
Expected negative migration-preflight messages and existing pg/Nest deprecations,
Vite `.env` NODE_ENV and bundle-size warnings remain. No environment/dependency
changes were made to silence them.

## Changed files and delivery boundary

- `apps/backend/src/mail/`: URL/rendering helpers, two adapters and MailModule DI.
- `apps/backend/src/config/environment.ts`, environment examples and
  `compose.prod.yml`: validated default-off destination; no secrets.
- `apps/backend/src/api/workspaces/workspace-api.module.ts`: MailModule import;
  invitation service, tokens, permissions, entities and schema unchanged.
- `apps/backend/test/auth/`, `test/workspaces/` and deployment config tests:
  provider binding, delivery/security and PostgreSQL integration coverage.
- Backend preview script/package command, two synthetic QA screenshots, task
  index, P2-03 handoff and production rollout guidance.

Work stays on `feat/workspace-invitation-email-delivery` with meaningful local
Conventional Commits. No push, PR, merge, deployment, production migration,
provider/DNS change, external coordination message or real email was performed.
