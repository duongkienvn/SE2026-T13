# MOB-23 Native Workspace collaboration

[Issue #288](https://github.com/duongkienvn/SE2026-T13/issues/288)

Workspace Overview links to separate Members, Guests and Permissions
screens. Each route verifies the Workspace through authenticated REST
before rendering a private section. Directory search is submitted to the
server by display name, and role changes or new searches start at page one.
Pagination uses the exact server total and returns to the last valid page if
the directory contracts. Member rows show Workspace role and joined date.
Guest rows show only returned Board roles, eligible association counts and
archived Board status. Roster avatars use the session transport for owned
images. External HTTPS images receive no session credentials.

## REST contracts

All paths below are under `/api/workspaces/:workspaceId`.

| Operation             | Method and response                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Verify Workspace      | `GET /` returns 200 with Workspace type, role and capabilities.                                                |
| Read members          | `GET /members?page=&limit=&search=&role=` returns a 200 page. Role is `ADMIN` or `MEMBER`.                     |
| Change role           | `PATCH /members/:userId` sends `{ role }` and returns the 200 member DTO.                                      |
| Remove member         | `DELETE /members/:userId` returns 204.                                                                         |
| Leave Team            | `POST /leave` returns 204 via MOB-12’s existing adapter.                                                       |
| Read guests           | `GET /guests?page=&limit=&search=` returns a 200 page of users and only inspectable Board-roster associations. |
| Read or save policies | `GET /policies` and `PATCH /policies` return 200. PATCH sends changed boolean fields.                          |

The four policy fields are `boardCreationAdminOnly`, `boardInvitesEnabled`,
`boardMembershipChangesEnabled` and `boardVisibilityChangesEnabled`.
Save requires verified Workspace ADMIN and a true `canManagePolicies`
response. The Board creation toggle is fixed on Personal Workspaces because
that policy applies to Teams. Other Personal policy switches follow the
capability response.

## Permissions and reconciliation

Only a verified Team ADMIN with `canManage` can open another member's action
sheet and confirm a role change or removal. The server enforces last-ADMIN
protection.
Self-service Team leave uses the existing capability and removes the
Workspace from authorized caches on 204. Removal and leave preserve explicit
Board grants. The client rechecks affected Boards through the existing
resource and Socket.IO flow before using their capabilities.

The guest endpoint requires Workspace membership and returns associations
only where the actor can inspect the Board roster by explicit membership.
Workspace ADMIN and a Board's Workspace visibility cannot grant roster
access. The decoder strips fields outside the response projection, checks
association counts and preserves the Board role separately from Workspace
role. Each Guest page is revalidated before cached Board associations can
be shown again.

Writes run one at a time per session and Workspace. They recheck actor
capability, wait for the server, and refresh scoped queries. Ambiguous
results require an explicit read before retrying. Child denials trigger a
Workspace detail probe. Confirmed loss evicts protected session caches and
stops pending requests. Board roster revocations fence Guest projections
so stale associations cannot repopulate the directory. Existing access and
Board hints drive authoritative reads. While focused, directory queries also
poll every 30 seconds for remote changes without a dedicated realtime event.
An uncertain Team leave in Overview follows its existing explicit access
verification flow. Members probes Workspace authority and requires a
fresh roster before another attempt if access remains.

## MOB-24 and MOB-25 handoff

- Extend the allowlisted `workspaceSections` in `navigation/routes.ts` and
  add a section and label in `WorkspaceCollaborationScreen.tsx`. Overview
  renders the same route entries.
- Use `workspaceCapabilityOptions` and `WorkspaceCollaborationContext` for
  verified Workspace context. `workspaceMembersOptions` and
  `workspacePoliciesOptions` expose the read contracts.
  `workspaceCollaborationKeys` provides stable prefixes for members, Guests
  and policies.
- Use `refreshWorkspaceMembership` after membership changes and
  `recheckWorkspaceBoards` to reverify affected Board grants and
  capabilities. Invitation creation and proof handling remain separate.

## Verification

- In the root `pnpm test` run, Shared passed 20 tests, Backend passed
  1,284 tests and Web passed 1,677 tests. Two Mobile component tests failed
  in that run. Overview now preserves the existing leave recovery step,
  and the policy test waits for the refreshed value to render.
- `pnpm --filter @kanban/mobile test` then passed all 278 Node tests and
  307 Jest tests across 25 suites on the final code.
- Three focused Node tests covered the exact API, response validation and
  cache eviction across Workspace and Board scopes.
- Seven focused Mobile component tests covered pagination for 251 members,
  role changes, removal, last-ADMIN leave handling, Personal leave
  restrictions, Guest privacy and page revalidation, policy draft recovery,
  rate limits, offline controls, ambiguous writes and late roster responses
  after account switching.
- `pnpm --filter @kanban/backend test:workspace-members:database` passed
  against disposable PostgreSQL 16. The suite exercised Guest roster ACL,
  archive and Board moves, role and removal races, retained explicit grants,
  policy enforcement and Socket.IO revocation.
- Root and Mobile lint passed. Root `pnpm build` passed including Mobile
  typecheck and Android Metro export. The native bundle verifier checked
  1,418 sources, the shared ESM entry and approved logo.
- Changed-file Prettier and `git diff --check` passed. On this Windows
  checkout, plain `pnpm format:check` flagged CRLF line endings in unchanged
  files. `pnpm format:check --end-of-line auto` passed.
- Pixel 8 emulator, Android API 36, 320dp and dark mode, against a disposable
  API and PostgreSQL database. Verified Overview routing, Team member
  promotion and the returned role, and the Board Guest projection. At 160%
  font scale, verified the four policy labels and switches, Android Back
  with a dirty draft, and a save persisted in PostgreSQL.
- Emulator evidence includes the [role confirmation](../../design/screens/implementation/mob-23-workspace-membership/role-confirmation.png),
  [Guest directory](../../design/screens/implementation/mob-23-workspace-membership/guest-directory.png),
  [large-text Permissions screen](../../design/screens/implementation/mob-23-workspace-membership/permissions-large-text.png)
  and [discard confirmation](../../design/screens/implementation/mob-23-workspace-membership/policy-discard.png).

## Verification limits

Component tests exercise accessible control names and roles. A manual
TalkBack reading-order pass, iOS device QA and a simultaneous Web/Mobile UI
session remain unverified. PostgreSQL integration tests exercise concurrent
server changes and authorized visibility.
