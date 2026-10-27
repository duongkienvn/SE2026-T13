# Account Settings V1, Appearance and Preferences (P1-05) — Issue #92

## Scope and integration

Authenticated Account Settings now follow the approved Settings layout
([visual reference](../../design/post-mvp/settings-notifications/approved-visual-reference-v1.png),
[UX spec](../../design/post-mvp/settings-notifications/ux-spec.md)) on desktop and
phone, with a functional Light / Dark / Match System theme and time zone, date
format and week start preferences. It is frontend-only: it consumes the existing
P1-01 `GET/PATCH /api/users/me/preferences` contract and the P1-06
`AccountSecurity` component. No API, migration, dependency or shared contract was
added.

Work was done on `feat/account-settings-appearance`, branched from `main` at
`e05d9bb` (includes App Shell V2, #91).

## Approved decisions

Clarified with the product owner before or during implementation (2026-10-27):

| Question                       | Decision                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile `/settings`             | Below 768px `/settings` is the section list; each section page has **Back to Settings**. From 768px `/settings` opens Profile.                  |
| First paint before preferences | Cache `{userId, theme}` in `localStorage`; an inline boot script applies it only for the same user. Cleared on logout/expiry.                   |
| Signed-out pages               | Landing, login, register and recovery follow the OS (`prefers-color-scheme`); no account's choice is shown before that account is known.        |
| Appearance preview             | Token-styled skeleton of the app, no names or sample data.                                                                                      |
| Account menu / mobile drawer   | "Profile" becomes **Settings** (`/settings`).                                                                                                   |
| Unsaved edits                  | Leaving Profile or Preferences with unsaved edits asks "Discard unsaved changes?" (Keep editing / Discard changes); closing the tab also warns. |
| Security page on short laptops | Two columns from `lg`: intro and recovery link beside the form; New and Confirm password share a row. No inner scroll at the target viewports.  |

## Routes and section model

```text
/settings                    -> section list (< 768px) or redirect to /settings/profile
/settings/profile            -> existing ProfilePage (PATCH /users/me)
/settings/appearance         -> AppearancePage
/settings/preferences        -> PreferencesPage
/settings/security           -> existing AccountSecurity (P1-06)
/settings/connected-accounts -> existing ConnectedAccounts
/profile                     -> redirect to /settings/profile (replace; query, hash and state kept)
```

All routes sit under `RequireAuth` and `AuthenticatedLayout`. `features/settings/sections.ts`
is the single section configuration (stable id, label, one-line summary, icon,
availability and a path only when available), in the approved order:
Profile, Appearance, Notifications, Preferences, Security, Connected Accounts,
Data & Privacy. **Notifications** and **Data & Privacy** are `soon`: a muted row
with a "Soon" badge, a `title` tooltip and screen-reader "coming soon". They are not
links or buttons, have no route (`/settings/notifications` is Not Found), and send
no requests. To activate one, build its page and authorization first, then give it
a path.

`AccountSecurity` and `ConnectedAccounts` moved from Profile to their own sections,
so each password and linking form exists once. `AccountSecurity` keeps its
contract from the [password security record](../backend/password-recovery-security.md);
`NewPasswordForm` gained an opt-in `pairNewFields` layout used only there, so public
reset keeps its layout.

## Theme

- **Tokens.** `style.css` re-points every semantic color under
  `:root[data-theme='dark']` and declares a `dark` custom variant on the same
  attribute. No indigo can be readable both as text on a dark surface and as a fill
  under white text (≥ 4.5:1), so tokens are split: `primary` is text, borders and
  focus rings (lightened to `#8f8bff` in dark); `primary-solid` / `danger-solid` are
  fills under white text (`#615cf7` in both themes). Backdrops use `overlay`, which
  stays dark. Remaining hardcoded tints (board tiles, role chips, Landing sections
  and previews, auth backdrop grid) have `dark:` variants next to the light value.
  Light mode is unchanged. Disabled solid buttons use the line surface in dark.
- **Boot.** `<script id="theme-boot">` in `index.html` runs before React. It uses
  the cached theme only when the stored session is unexpired and its token subject
  equals the cached `userId`; otherwise it resolves the OS scheme. Any parse error
  falls back to the OS.
- **ThemeSync** (in `AppProviders`): signed out → OS; signed in → server value,
  else this user's cache, else OS; while the session is still being confirmed it
  keeps the boot result. `system` tracks OS changes live; an explicit choice
  ignores them. It writes the cache per user and clears it when a signed-in session
  ends. Known first-load trade-off: a new tab has no session (sessionStorage), so it
  follows the OS until sign-in.

## Preferences data layer

`features/settings/hooks.ts`:

- `usePreferences()` loads only with a signed-in user; the cache key is dropped at
  every session boundary by `queryClient.clear()`.
- `useUpdatePreferences()` sends only changed fields and shows them at once. While
  other saves are pending, a response is merged only for its own fields, so
  out-of-order replies cannot clobber each other. A failed save restores its own
  fields only if no newer edit replaced them, and the last settling failure refetches
  the authoritative value. Responses from an ended session are ignored.

Appearance saves immediately and shows "Saved" only after the server confirms.
Preferences is a form with Save changes / Cancel; server validation errors land on
their field.

Time zones come from `Intl.supportedValuesOf('timeZone')` plus `UTC` (not listed by
Chrome/Node), with renamed zones mapped to modern names (for example
`Asia/Saigon` → `Asia/Ho_Chi_Minh`) and the saved zone always kept. Helpers in
`features/settings/format.ts`: `formatCalendarDate` rearranges a `YYYY-MM-DD` value
as text, so a time zone can never shift a due date; `formatInstantDate` and
`formatTimeIn` show an instant in the chosen zone. Only the Settings preview uses
them in this issue; Card dates are not rewritten (Phase 3/5).

## Visual comparison with the reference

| Reference element                        | Implementation                                                   |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Settings rail with seven sections        | Same order and icons; two Soon slots.                            |
| Profile Bio, Change Avatar, Remove       | Not shown (not approved). The existing avatar URL field stays.   |
| Security "Sessions" and device Log out   | Not shown: needs a server session registry.                      |
| Appearance Light / Dark / Match System   | Same three cards with a token-styled preview.                    |
| Mobile "Sync with system theme" toggle   | Covered by Match System; no separate toggle.                     |
| Mobile bottom tabs                       | Not added; the App Shell V2 drawer stays canonical (UX spec §7). |
| Notifications pages, popover, bell badge | Not built (later workstream); header bell stays a static slot.   |
| Language selector                        | Not shown until translations exist.                              |

## Evidence

Screenshots in
[implementation/account-settings-appearance](../../design/screens/implementation/account-settings-appearance/),
captured with Chrome against Vite and a route-mocked API at 1366×657 (desktop) and
390×844 (mobile):

- Each working section in both themes: `<section>-desktop-light.png`,
  `<section>-desktop-dark.png`, `<section>-mobile-light.png`,
  `<section>-mobile-dark.png` for `profile`, `appearance`, `preferences`,
  `security`, `connected-accounts`. The rail shows the two Soon slots in every
  desktop shot.
- `settings-list-mobile-light.png`, `settings-list-mobile-dark.png`: all seven
  sections on phones.
- Dark mode elsewhere: `board-dark.png`, `card-detail-dark.png`, `login-dark.png`.

Fit (main area, no scroll) measured at 1280×600, 1366×657, 1536×730, 1920×945 and
390×844 for every section in both themes. Not fitted: 320×568 (Appearance 93px,
Preferences 276px) and Security at 1024×640 (31px); neither is a target size.

## Checks

- `pnpm lint`, `pnpm --filter frontend build`: pass.
- Frontend tests: 747/747 (86 files). New: data layer (10), theme boot script run
  from the real `index.html` (9) and ThemeSync (7), Settings shell (9), Appearance
  (4), Preferences (7), format helpers (8). Mutation checks: 23 of 26 seeded faults
  caught; the uncaught ones were a redundant session check (removed), a defensive
  `onSuccess` scope check (`runAuthorized` already rejects ended sessions) and hint
  wording.
- Under full-suite load a few unrelated page tests occasionally exceed the 3s wait
  and pass alone (also seen on `main` during #91). Profile tests had a real title
  race exposed by the redirect; fixed by waiting for the title effect.
- `mockApi` now answers `GET /users/me/preferences` with defaults, since every
  signed-in app requests it.
