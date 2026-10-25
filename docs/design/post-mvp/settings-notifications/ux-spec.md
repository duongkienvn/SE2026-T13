# Kanvexa — Account Settings & Notification Center V1 UX Specification

**Status:** Approved visual direction; implementation behaviors constrained by authentication model and approved scope.  
**Image:** `approved-visual-reference-v1.png` (Profile, Notifications, Notification Preferences, Popover, Security, Appearance, Mobile).

## 1. Account Settings navigation

- Desktop: profile-focused page with narrow section rail and content form. Sections: Profile, Appearance, Notifications, Preferences, Security, Connected Accounts, Data & Privacy.
- Mobile: section list then full-width detail page, visible Back to Settings behavior; preserve App Shell mobile navigation consistency.
- `/settings` redirects to `/settings/profile`; preserve `/profile` as an alias/redirect when new settings shipped.
- Existing profile and connected Google-account logic is reused, not duplicated. Unsaved edits have explicit save/cancel, error validation and retry.

## 2. Profile and Connected Accounts

- Current MVP profile fields: display name, avatar URL, read-only email. Account management later supports verified email change with secure new-email flow.
- Google linked accounts use actual provider status and identity guardrails. Do not enable Google disconnect if it could lock user out and no secure replacement login exists.
- Mockup's `Bio`, `Change Avatar` upload and `Remove` controls are **not** automatically approved as features. Present existing avatar URL flow unless new requirements signed off.

## 3. Appearance and Preferences

- Three theme choices **Light / Dark / Match System** (mutually exclusive). Preview is optional; persisted choice applies across authenticated UI and appropriate public pages without layout flash.
- No hardcoded screenshot colors: use semantic tokens with dark-mode overrides, retain official brand logo.
- Preferences: language once localization is complete, IANA timezone, date format and week start. UTC data storage vs per-user display must be explicit.
- Accessible focus and contrast in both themes; avoid OS setting changes clobbering an explicit user choice.

## 4. Security

- Change password: existing-password reauth when applicable; Google-only Set Password requires secured verification; Forgot Password sends email with non-enumerating response, short-lived single-use token.
- Change email: prove new email ownership and invalidate/reauthorize relevant flows as needed.
- Session/Device list and `Log out other device` **cannot be real with client-only logout and stateless JWT**. Only implement when server-side revocation/session registry exists, with tests for cross-device invalidation.
- Delete account: reauth/confirmation, ownership transfer or refusal for last admin/Board ownership, explicit data handling and safe irreversible-action messaging.
- Security notifications (password reset, email verification) are mandatory transactional flows, not user-toggleable marketing/task preferences.

## 5. Notification Center

- Header bell opens compact popover with recent unread notifications and `View all`; `/notifications` shows full All/Unread timeline.
- Each item includes event icon, short plain-language summary, origin/context and time; unread visually differentiated without relying only on color.
- Initial event types: Card assign, comment mention, due reminder, Workspace/Board invite, member/access change. Generic every-Card-update email remains opt-in/deferred.
- Clicking notification navigates to authorized Board/Card/Workspace destination and updates read state appropriately. If access was revoked, present safe unavailable message.
- Header unread count and full list remain consistent through reconnect/reload with backend persisted read state; realtime is enhancement, never sole persistence.
- Handle empty, pagination, load/retry, stale item, and all/mark-read, including reduced motion and keyboard.

## 6. Notification Preferences

- Separate toggles for in-app categories and email task notifications. Do not offer a switch that purports to disable essential account/security email.
- Store preferences server-side; scheduling timezone and email delivery rate limits controlled by backend policy.
- Avoid notification storms: group/dedupe repetitive activity; prevent notify-self when unnecessary, and never leak restricted card text in email or toast.
- Notification options only appear once a corresponding notification channel exists and is operational.

## 7. Explicit screenshot exceptions

- Security mockup shows `Sessions`/per-device Log out; these require auth service support, not just UI.
- Profile mockup shows new Bio/avatar upload actions; not current approved core requirements.
- Mobile screenshot shows bottom tabs; the App Navigation V2 drawer remains canonical unless redesigned later.
- Names, dates, statistics, avatars and emails are illustration placeholders.
- No `Free Plan`, `Pro`, pricing, subscription or promotional widgets.

## 8. Acceptance checks

- `Tab`, `Enter`, `Space`, `Escape`, focus restore in notification popover and every dialog; WCAG-style contrast.
- Account data scoped to current user; settings save returns accurate results; auth errors do not expose account existence.
- Realtime unread state matches persisted state and permission changes.
- Themes stay consistent on refresh in desktop/mobile and across protected routes.
- Security endpoints have request throttling, token expiration/replay protection and meaningful audit/logging with no secrets exposed.
