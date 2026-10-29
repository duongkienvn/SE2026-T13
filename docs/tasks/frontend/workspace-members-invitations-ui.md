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
  the role and controls update; 404 hides the Workspace through the existing
  `revokeWorkspaceAccess`.
- **Invite dialog**: email only; role is fixed to Member (the API rejects ADMIN
  invitations — promote after joining). The 202 result is reported by
  `sendState`: `SENT` → "Invitation email sent", `UNAVAILABLE` → saved but **no
  email was sent**, `FAILED`/`UNKNOWN` → not confirmed, send again later. 429
  distinguishes the 60-second cooldown from the hourly quota.
- **Invitations tab** (ADMIN only; a MEMBER sees an explanation and no request
  is sent): status filter, status badge, delivery text only while Pending
  (terminal status first), "You"/"Another admin" as inviter (the DTO has only
  `invitedById`), expiry, Revoke (confirmation) and Send again / Invite again
  (the same POST; the backend rotates the proof). No decline/resend endpoint
  exists, so there are none.
- **Guests tab**: Coming soon, non-interactive. No backend Guest projection
  exists and the browser must not enumerate PRIVATE Board membership.
- **Leave Workspace** is not on this page; it belongs to P2-09 Settings Danger
  Zone (#118).

## Invitation acceptance

- The proof is read once from the fragment (`#proof=`, strict 43-char base64url),
  kept only in module memory, and the fragment is removed immediately with a
  `replace` navigation. Nothing goes to storage, query string, router state,
  logs or analytics. Opening the link never calls the API.
- Signed out: Sign in / Create account carry `from: /invitations/workspace`, so
  sign-in returns to the page with the proof still in memory. Registration needs
  email verification in another page load, so the page tells the recipient to
  open the link again afterwards (the proof stays valid until used).
- Signed in: shows the account email; **Accept invitation** posts
  `{ proof }` to `/workspace-invitations/accept`; success clears the proof and
  invalidates the Workspace list. 400/410 show one generic message (expired,
  revoked, used or wrong account) and keep the proof so the user can switch
  account; 403 asks for verification, 409 says delivery is unconfirmed, 429
  asks to wait. "Use a different account" signs out; "Not now" drops the proof.
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

## For the team

- **P2-10 destination**: this page is the proposed acceptance path. Set
  `WORKSPACE_INVITATION_ACCEPT_PATH=/invitations/workspace` only after the
  owner of #119 agrees and the gate steps in its record are done. Until then
  the backend returns `sendState=UNAVAILABLE` and the UI says no email was sent.
- Member DTO has no workspace id on accept, so success links to `/workspaces`
  rather than the joined Workspace.
- Deferred to #118: Leave Workspace, policies, Danger Zone.
