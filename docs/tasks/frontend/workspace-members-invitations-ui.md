# Workspace Members, Guests and Invitations UI V1

Local implementation record for
[#117 (P2-08)](https://github.com/duongkienvn/SE2026-T13/issues/117), 2026-10-29.
Uses the merged [P2-03 members/invitations API](../backend/workspace-members-invitations-api.md)
and the [P2-10 invitation email contract](../backend/workspace-invitation-email-delivery.md),
inside the existing [Workspace shell](workspace-shell-overview.md) and
[API integration](workspace-api-integration.md). Frontend only; no backend,
shared package, dependency or lockfile change. This describes the checkout
and local verification, not a deployment.

## Routes

| Route                                     | Access                       | Purpose                                      |
| ----------------------------------------- | ---------------------------- | -------------------------------------------- |
| `/workspaces/:id/members`                 | Signed in, Workspace member  | Members tab (default)                        |
| `/workspaces/:id/members?tab=invitations` | Same; data for ADMIN only    | Invitation history                           |
| `/workspaces/:id/members?invite=1`        | Team ADMIN                   | Invite dialog (header **Invite** links here) |
| `/invitations/workspace#proof=<43>`       | Public; accept needs sign-in | Invitation email destination                 |

The Members section is now **Available** in Workspace tabs, sidebar sub-navigation
and the Workspace switcher (`workspaceDestination` keeps `/members`).

## Behavior

- **Members tab**: `GET /workspaces/:id/members` with server `search` (debounced
  300 ms, URL `q`), `role` filter (URL `role`) and numbered pages of 10 (URL
  `page`). Rows show avatar (existing `UserAvatar` private-avatar rules), name,
  "(you)", Workspace role chip (Admin/Member only) and joined date. No email
  and no Board count: the DTO has neither.
- **ADMIN actions** (Team Workspace, not on your own row): Make admin / Make
  member and Remove from workspace, each behind a confirmation. Caches change
  only after the server confirms, then the whole Workspace resource is
  invalidated (roster, invitations, Overview count). Refusals: 409 (last ADMIN,
  self change) shows the server reason and reloads; 403 reloads the Overview so
  the role and controls update. A role-change 404 can mean the target member
  disappeared, so it refreshes the roster and Overview to revalidate access.
  Confirmed Workspace access loss hides the Workspace through the existing
  `revokeWorkspaceAccess`. Refreshed member totals clamp an out-of-range page
  to the last available page (at least page 1), preserving search and role.
- **Invite dialog**: email only; role is fixed to Member (the API rejects ADMIN
  invitations — promote after joining). The 202 result is reported by
  `sendState`: `SENT` → "Invitation email sent", `UNAVAILABLE` → saved but **no
  email was sent**, `FAILED`/`UNKNOWN` → not confirmed, send again later. 429
  distinguishes the 60-second cooldown from the hourly quota. Opening/closing
  the dialog preserves query filters; switching tabs resets them.
- **Invitations tab** (ADMIN only; a MEMBER sees an explanation and no request
  is sent): status filter, status badge, delivery text only while Pending
  (terminal status first), "You"/"Another admin" as inviter (the DTO has only
  `invitedById`), expiry, Revoke (confirmation) and Send again / Invite again
  (the same POST; the backend rotates the proof). No decline/resend endpoint
  exists, so there are none. Both lists accept positive integer page values
  up to 1,000,000; invalid values fall back to page 1.
- **Guests tab**: originally Coming soon in P2-08. The later
  [P2-C02 Guests implementation](workspace-guests-directory-ui.md) activates
  the merged ACL-scoped directory; the browser never enumerates PRIVATE Board
  membership to construct it.
- **Leave Workspace** is not on this page; it belongs to P2-09 Settings Danger
  Zone (#118).

## Recipient decline follow-up

The recipient can explicitly accept or decline after signing in. Decline opens a
confirmation dialog; cancel sends nothing, and confirmation posts the fragment
proof to `/workspace-invitations/decline`. A confirmed 204 shows “Invitation
declined” and links to Workspaces without claiming membership. The ADMIN history
filter includes `DECLINED`, using the server status and `declinedAt` contract in
the [backend handoff](../backend/workspace-invitation-decline.md).

The proof stays in tab memory only and is cleared after success or an account
change. Reloads, new tabs, email verification and Google redirects require opening
the email link again. Both actions require a new click after a network failure;
an ambiguous failure cannot establish whether the server committed the action.
400/410 share a non-enumerating unusable message; 401 requires sign-in again,
403 verification, 409 a new invitation and 429 a delay. Accept's existing guard
can also return 401 for an unverified account. Backend migration must precede UI
rollout.

Follow-up verification: the focused invitation and Members suites passed 62
tests, including decline confirmation, status/error handling, explicit retry,
session changes and the declined history filter. The client requires HTTP 204
for a confirmed decline. The full frontend suite also passed 1,090 tests across
102 files. A subsequent Chrome headless run used a local mock API and tested
320, 375, 768 and 1280px in light and dark: no horizontal overflow, fragment
removal, confirmation focus, Tab trapping, Escape cancellation/focus restore,
and one confirmed 204 request with success heading focus. The
[screenshots and results](../../design/screens/implementation/workspace-invitation-decline/)
show the review and dialog states. Representative phone, tablet and desktop
screenshots were visually inspected. This is browser automation and visual
inspection, not a manual screen-reader audit; that audit remains outstanding.
The full `pnpm test` subsequently passed with Node 24, two frontend workers,
30-second frontend timeouts and temporary 300-second subprocess limits for two
slow backend tests: 1,090 frontend, 708 backend and seven shared tests. These
runtime limits were supplied for that run without changing repository tests.
`pnpm --filter @kanban/backend test:workspace-invitations:database` also passed
against its own disposable PostgreSQL container, covering migration, HTTP and
Swagger contracts, recipient binding, replay, history and concurrent terminal
actions. The container was removed afterward. This does not verify deployment
or that the migration has been applied in any other environment.

## Invitation acceptance

- Each new invitation link reads its own fragment (`#proof=`, strict 43-char
  base64url) and resets the acceptance state. The proof stays only in memory;
  the fragment is removed immediately with a `replace` navigation. The proof
  never goes to storage, query string, router state, logs or analytics. Opening
  the link never calls the acceptance API.
- Signed out: Sign in carries `from: /invitations/workspace?resume=<id>`.
  The non-secret, one-time return marker matches the proof held in module
  memory for that explicit sign-in flow; the return consumes the handoff and
  removes the marker. A bare or malformed link never reuses an abandoned proof.
  Create account carries `from: /invitations/workspace`; registration needs
  email verification, so the recipient must open the email link again afterward.
  Proofs expire after seven days and can be invalidated earlier by revocation,
  reinvitation or successful acceptance.
- Signed in: shows the account email; **Accept invitation** posts
  `{ proof }` to `/workspace-invitations/accept`; success ends the flow and
  invalidates the Workspace list. 400/410 show one generic message (expired,
  revoked, used or wrong account) and keep the proof in the current flow for a
  retry; 403 asks for verification, 409 says delivery is unconfirmed, 429 asks
  to wait. "Use a different account" signs out and drops the proof; "Not now"
  also drops it.
- No proof (reload, opened without fragment): "Open your invitation link".

## Visual parity

Reference: `docs/design/post-mvp/workspace/approved-visual-reference-v1.png`
(Members panel) and `ux-spec.md` §4.

| Reference element                   | State                        | Note                                                  |
| ----------------------------------- | ---------------------------- | ----------------------------------------------------- |
| Title, subtitle, Invite Member      | Available                    | Disabled with reason for MEMBER / Personal            |
| Members / Invitations / Guests tabs | Available / Available / Soon | Guests: no safe API                                   |
| Search + All roles filter           | Available                    | Server-side                                           |
| Name, Role, Joined, Actions columns | Available                    |                                                       |
| Email under name                    | Excluded                     | Member DTO has no email (privacy)                     |
| Boards count column                 | Excluded                     | No permitted count; never derived from private Boards |
| Owner/Viewer chips                  | Excluded                     | Workspace roles are ADMIN/MEMBER only                 |

Sample people in the reference and in QA screenshots are QA-only route mocks;
production shows only API data.

## Evidence

Screenshots in
[implementation/workspace-members-invitations/](../../design/screens/implementation/workspace-members-invitations/)
(18 files, all viewed): ADMIN at 768/1366/1920, Invitations at 1920, MEMBER,
Personal, invite dialog, remove confirmation, empty invitations, dark Members
and Invitations, phones 375/390, accept (ready, 410, signed out, no proof, dark).
Taken from a production build (`vite preview`) with Playwright route mocks.

- No horizontal overflow at 320/375/390/768/1280/1366/1920; touch targets
  ≥ 44 px in the page (the only smaller links are the existing breadcrumbs).
- The Workspace frame (breadcrumb, identity header, two tab rows) is taller
  than short laptops: main scrolls 259 px at 1366×657 — the merged Overview
  scrolls 188 px there too. 1920×945 and 768×1024 fit. Fixing the shared frame
  height is outside this issue.
- QA note: if the socket.io request is aborted, `connectionLost` clears all
  Workspace snapshots by design (#128), so mocks must leave it pending.

## Checks

- Root `pnpm lint` pass; frontend `vitest` 914/914; shared 7/7; root
  `pnpm build` pass; `git diff --check` clean; prettier (auto EOL) clean on
  changed files.
- New tests: 15 Members/Invitations page tests, 7 acceptance tests. Mutation
  check 6/6 caught (delivery shown for terminal rows, UNAVAILABLE reported as
  sent, fragment not cleared, invitations fetched for MEMBER, actions on own
  row, 409 not reloading).

## PR #130 review follow-up (2026-10-30)

All six inline CodeRabbit/Codex threads and CodeRabbit's review-body pagination
nit were checked against the current code and addressed. The two member-level
404 findings describe the same race. The changes above also preserve filters
when the shared header's Invite link opens the dialog from Members.

- Added 25 regressions across the two affected test files (47 tests total):
  member-level 404 versus actual access loss; deletion/role-filter pagination
  recovery, empty totals and placeholder data; both dialog entry points and tab
  resets; invitation page bounds; new/abandoned proofs, explicit sign-in return,
  verified-email refusals and late acceptance after an account switch.
- `pnpm lint` and `pnpm build`: pass. Build retains the existing Vite
  `NODE_ENV` and chunk-size warnings.
- `pnpm test` with `VITEST_MAX_WORKERS=2` and
  `npm_config_workspace_concurrency=1`: pass (shared 7, backend 687, frontend
  937 before the final header-link extension). Final
  `pnpm --filter @kanban/frontend test --maxWorkers=2`: 939/939 pass.
  Default parallel runs encountered unrelated frontend timeouts; the initial
  overlapping build/test run also raced the shared package rebuild. No test
  configuration was changed.
- `pnpm format:check`: fails on 787 untouched CRLF files in this Windows
  checkout. All 10 changed files pass the configured Prettier check; the full
  repository passes `pnpm exec prettier --check . --end-of-line auto`.
  `git diff --check` and the record's local link/path checks pass.
- Chrome QA with isolated fixtures: Members/Invitations dialog filters,
  role-change page recovery, new invitation links and abandoned-proof rejection;
  desktop 1440×900 and mobile 375×812, light/dark, no horizontal overflow or
  console errors after a clean reload. Dialog cancellation retains filters and
  restores focus. No style or markup changes; the temporary harness was removed.
- Real PostgreSQL and backend/mail acceptance integration were not run: this
  follow-up changes only frontend behavior and documentation. No remote review
  replies or thread resolutions were performed.

## For the team

- **P2-10 destination**: this page is the proposed acceptance path. Set
  `WORKSPACE_INVITATION_ACCEPT_PATH=/invitations/workspace` only after the
  owner of #119 agrees and the gate steps in its record are done. Until then
  the backend returns `sendState=UNAVAILABLE` and the UI says no email was sent.
- The invitation acceptance response has no Workspace id, so success links to `/workspaces`
  rather than the joined Workspace.
- Deferred to #118: Leave Workspace, policies, Danger Zone.
