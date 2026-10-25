# Kanvexa — Workspace UI V1 UX Specification

**Status:** Approved visual direction, subject to product security rules.  
**Image:** `approved-visual-reference-v1.png` (Overview, Boards, Members, Settings collage).

## 1. Shared workspace frame

- Breadcrumb `Workspaces > {Workspace} > {section}`; Workspace icon/name/description and members summary; accessible section navigation Overview / Boards / Members / Settings.
- Workspace group in Sidebar reflects active selection and permitted sub-navigation. Workspace data is never inferred from Board-only data on the client.
- Only permitted workspace members can access Workspace-managed pages. Board Guests should see only their individual shared Board, **not** a Workspace's protected member list, overview or settings.
- Use existing Kanvexa palette and component library; reference images use illustrative landscapes/avatars rather than licensed production assets.

## 2. Overview page

- Name/description, count of **visible** boards, membership summary when authorized, recent boards (permission-filtered) and relevant activity; no leaking Private Board existence through counts or previews.
- Empty: first workspace with no boards → Create Board when policy allows, otherwise guidance.
- Do not invent 'active this week' analytics unless backed by clear, audited metric definitions and efficient queries. The screenshot's numbers are not requirements.

## 3. Boards page

- Search, status (All/Recent/Starred/Archived as permitted), filters, sort controls, Grid/List view optional only when scoped. Board cards show name, background, member summary and last update from real records.
- Create Board button only for authorized users; new Board belongs to current Workspace and defaults PRIVATE.
- Archived boards remain discoverable to people still authorized, with read-only/restore rules.
- Board transitions preserve ID and metadata; move Board cross Workspace requires explicit permission and access review.

## 4. Members page

- Tabs for current Members, pending Invitations, Guests (based on distinct Board membership); search and role filter.
- Roles: Workspace ADMIN and MEMBER. Keep Board OWNER/MEMBER separate. No extra Viewer/Owner role created from pictured chips.
- Admin-only actions: invite, revoke pending invitation, change Workspace role and remove Workspace member. Prevent loss of last admin and dangerous self-demotion.
- Invite flow: email → pending → verified login/register → accept/reject → visible membership; handle expiry, already-member and invalid token safely.
- Guest area must not leak private other-Board memberships, depending on actor authorization and policy.

## 5. Settings page

- Desktop left nav: General / Members & Invitations / Permissions / Danger Zone; mobile grouped settings list.
- General: name, description, optional icon. Permission tab: who may create Board, invite at Board level, alter membership and visibility. Admin-only writes.
- Danger Zone: Leave Workspace for non-last-admin only under policy; delete Workspace only when zero boards and no ownership conflict, with explicit confirmation/re-auth as appropriate.
- Preserve unsaved form data on failed network update; show validation and retry.

## 6. Critical security and migration constraints

- Exactly one Workspace per Board; `Workspace ADMIN` **does not automatically view PRIVATE Boards**.
- `WORKSPACE_VISIBLE` is read-only for Workspace members lacking explicit Board membership.
- Legacy Boards migrate to creator's Personal Workspace, **retain PRIVATE**, keep Board members/assignees/comments unchanged.
- Add/Remove/Role changes must invalidate restricted queries and revocation-sensitive Socket.IO rooms.
- Workspace Board count/search/global discovery use backend ACL, not frontend filtering over confidential data.

## 7. Acceptance checks

- Verify all four pages desktop and mobile; large workspace lists and long names wrap/scroll correctly.
- Empty/permission error/invitation expiry/archived/unsaved/rate-limit states covered.
- Members and Settings management are hidden/unusable when actor lacks permission; backend rejects forbidden direct calls.
- Screen readers get role/name/action/status, focus returns after dialogs.
- Migration QA confirms all legacy Board ID links and member privileges still work.
