# MOB-24 Native Workspace invitations

[Issue #289](https://github.com/duongkienvn/SE2026-T13/issues/289)

Team Workspace ADMINs open Invitations from Members. The typed
`workspaceSection` route uses MOB-23 capability verification. The invitation
query is a child of the existing identity and Workspace query prefix, with
server pagination and status filters. The app retires that query when its
observer leaves and fences it on Workspace or session access loss.

## REST contracts

| Method and path under `/api`                                | Request and success response                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `POST /workspaces/:workspaceId/invitations`                 | Normalized `email`, fixed `role: MEMBER`; 202 invitation metadata.  |
| `GET /workspaces/:workspaceId/invitations`                  | `page`, `limit`, optional `status`; 200 paginated metadata.         |
| `DELETE /workspaces/:workspaceId/invitations/:invitationId` | Confirm an eligible pending row; 204 empty.                         |
| `POST /workspace-invitations/accept`                        | Explicit recipient action with `{proof}`; 200 Workspace member DTO. |
| `POST /workspace-invitations/decline`                       | Explicit confirmed recipient action with `{proof}`; 204 empty.      |

The admin response decoder allowlists the thirteen invitation metadata fields.
Invitation lifecycle uses PENDING, ACCEPTED, EXPIRED, REVOKED and DECLINED.
Delivery independently uses UNAVAILABLE, DISPATCHING, SENT, FAILED and
UNKNOWN. A 202 displays “Invitation requested” plus the reported delivery
state. The backend requires SENT to redeem a proof. Admin writes recheck
Team ADMIN capability, avoid automatic retries, and refresh only invitation
history. An uncertain write asks the admin to check current history before
retrying. HTTP 429 respects Retry-After, with a one-minute client cooldown
when the response omits that header.

## Proof and authentication boundary

The native intent handler matches the raw canonical
`https://kanvexa.tech/invitations/workspace#proof=…` link with exactly 43
Base64URL characters. It returns only `/invitations/workspace` to Expo
Router. Encoded paths, query proofs, alternate authorities and invalid
fragments cannot supply a proof. The private holder exposes a redacted
availability snapshot and one identity-bound claim. It retains proof for
at most ten minutes of local handoff. Cancellation, session teardown,
replacement, expiry, successful responses and terminal failures clear the
proof. A new link cancels a pending claim. A rate limit or a failure known
to precede the request permits a controlled retry within the same lifetime.
The holder gives only the explicit recipient POST access to the proof.

Password sign-in and signup/email verification reuse MOB-08 and keep a
proof-free return route in navigation memory. Starting Google sign-in
clears the proof. Process death discards it. The empty route asks the
recipient to reopen the original email. Verification and recipient email
matching are enforced by the backend. The client has no preview endpoint
and treats wrong-account, expired, revoked and consumed proofs as the same
unavailable result. It does not echo backend invitation errors.

Acceptance refreshes the authoritative Workspace directory and notifications.
The existing member DTO contains no Workspace ID. The app opens a Workspace
only if it finds one new directory entry, matches the returned member in its
roster and separately verifies Workspace detail. In an ambiguous case or
when any verification fails, the confirmation leads to Boards and the
updated Workspace selector. Decline clears the proof and offers the safe
Boards destination without changing membership or notification counts.

## Verification and integration limits

Six focused Node tests passed for canonical parsing, redacted handoff,
session-bound claims, expiry, exact API statuses and cooldown forwarding.
Twelve focused Mobile component tests passed for admin controls, form and
delivery state, history and revoke, signed-out handoff, accept, decline,
offline and error handling, logout and account replacement.

`pnpm test` passed 20 Shared, 1,284 Backend and 1,677 Web tests. The initial
Mobile run found three regressions in existing navigation restoration.
The targeted navigation suite passed all eight tests after limiting the
in-place restore to the public invitation route.
The final `pnpm --filter @kanban/mobile test` run passed 310 Node tests and
350 Jest tests across 27 suites.

`pnpm lint`, Mobile lint and typecheck, and `pnpm build` passed. The build
exported Android Hermes bytecode and verified 1,465 native sources.
Plain `pnpm format:check` reported Windows CRLF differences. The root
check with `--end-of-line auto`, changed-file formatting and
`git diff --check` passed.

`pnpm --filter @kanban/backend test:workspace-invitations:database` passed
against disposable PostgreSQL with test mail. It covered verified recipient
matching, replay rejection, expiry, revoke and accept races, cooldown,
history and membership outcomes. The migration guard failure in its output
was an expected negative test for duplicate open invitations.

The Android Pixel 8 emulator booted. Its intent resolver selected Chrome
for the proof-free canonical HTTPS path. The tool's automatic approval
review blocked launching Expo Metro with the loopback API, so native visual
checks at 320dp and 160%, keyboard and screen reader checks, and screenshots
remain open. Native client link intake was tested with synthetic links.

The app leaves existing Android and iOS association configuration intact.
An established native association requires Android intent filters and
Digital Asset Links for the signed package, or iOS Associated Domains and
AASA for the signed app. The existing HTTPS link remains compatible with
the Web route. No production association, live mail transport, or verified
iOS Universal Link was exercised in this task.
