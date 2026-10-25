# Kanvexa — Board & Card Detail V2 UX Specification

**Status:** Approved visual direction, approved interaction rules.  
**Image:** `approved-visual-reference-v1.png` (desktop board/card, popovers, archived dialog, mobile).

## 1. Board shell and header

- Existing Kanban and drag/drop stay in place; this is a targeted experience upgrade.
- Breadcrumb Workspace > Board; heading, star/favorite, privacy chip, online presence (actual realtime presence only), member avatars, share/invite, overflow menu.
- Contextual nav supports Kanban, Members, Activity and Board Settings; extra Calendar/Table tabs **only when delivered**.
- Board menu groups About, Activity History, Archived Cards, Change Background, Board Settings and authorized Archive. Surface contextual edit actions according to role.
- Viewer-only Workspace members and archived Boards see read-only controls; no confusing active-looking edit affordances.

## 2. Board filtering and Card preview

- Board Filter popover: keyword, assignees, labels, due date statuses, clear/apply; filter state in URL when practical. Search only accessible cards; filter retains column ordering and drag policy.
- Cards: short title, clipped description, labels, due status, checklist fraction/progress, attachment/comment counts, avatar group. Avoid overcrowding and horizontally shifting layout when badges appear.
- Dense Board: virtualize/efficiently render as needed without breaking keyboard drag, realtime, card focus or drop targets.

## 3. Card Detail layout

- Desktop: wide dialog or route-linked modal; prominent title, parent Board/Column, description editor, checklists, attachments, comments; metadata/actions side column for members, labels, dates, Duplicate, Copy Link, Archive.
- Mobile: full-screen single-column detail; large tap targets, sticky close/action access when possible, avoid nested horizontal overflow.
- Add to Card button/menu reveals **only approved and implemented** content blocks. No inactive decorative control.
- Description editing: explicit Edit → Save/Cancel with dirty-form warning on navigation, never silent lost drafts.
- Checklist actions (add/remove/toggle/reorder as scoped) persist individually; progress recomputed from authoritative checked counts.
- Attachment previews require valid authenticated access. Avoid file URLs that expose private documents to unauthorized users.
- Assignees, labels and dates share clear popover/date-picker patterns; timezones and due state are consistent with Preferences.
- Comments existing behavior retained, later @mention integrated without losing realtime edit/delete behavior.

## 4. Card route and archive

`/boards/:boardId/cards/:cardId` must open directly on fresh browser load; route guard checks actual Board/Card access. From Board, click opens overlay while preserving Board context; close/back should restore prior Board route and scroll/filter as feasible. Sharing a permalink does not override access restrictions.

Archive Card: preserve data and make view read-only. Restore on active Board and with Board mutation permission, with valid ordering/column rules. Archived Board containing Card cannot be modified via child endpoint. Archive list dialog only shows eligible cards and contains authoritative Restore buttons.

## 5. Realtime, offline and permission changes

- Incoming Card updates should not overwrite an unsaved description or draft checklist edit. Detect conflict/reconcile field changes or present safe refresh option.
- If someone archives the Card or removes access, stop mutation UI, retain unsent local draft only as permitted, invalidate protected cache and notify user.
- Failed mutations show actionable feedback with retry and no false saved/toast success.
- Board presence is ephemeral per active connection; don't invent last-seen records.

## 6. Explicit mockup corrections

- Image contains **Delete**, **Move**, **Group** buttons: do **not** implement hard delete, cross-board moves, arbitrary grouping or new backend endpoints from those visuals. Use approved actions only.
- Image contains labels like Priority/High; dedicated Priority remains out of scope. These can be ordinary configurable labels.
- Some images use blue primary CTAs: implementation uses Kanvexa indigo `#615CF7`.
- No Card-cover feature is mandated by image decoration; attachments are authorized based on explicit scope.

## 7. Acceptance checks

- Verify desktop/mobile width, large Board with many columns/cards, keyboard drag and focus, filter clear, breadcrumbs and deep link on fresh load.
- Owner/member/read-only guest/workspace viewer, archived Board/Card, lost membership and no-access states tested.
- Realtime concurrent edits, one-card archive during edit, attachment auth and restoration ordering covered.
- Existing MVP Card/Comment endpoints continue to work and retain data.
