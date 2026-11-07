# P5-08 Verified email change and safe account deletion UI

Implements [issue #225](https://github.com/duongkienvn/SE2026-T13/issues/225)
(roadmap AC-01) against the merged backends
[#217 verified email change](../backend/p5-secure-email-change.md) and
[#218 account deletion](../backend/p5-account-deletion.md). It builds on
[P5-07 Data & Privacy exports (#224)](p5-data-export-ui.md). Frontend only: no
backend, migration or dependency change.

## Settings → Security

The page keeps the `Security` heading without a decorative icon and shows two
cards in the approved narrow column (`max-w-2xl`):

1. **Change password** — the existing `AccountSecurity` workflow (same
   validation, reauthentication, sign-out after success and Google-only
   "Set password via email" path), restyled with the approved title and an
   inline "Recover a forgotten password" link.
2. **Change email** — read-only current email with a Verified chip; a
   **Password / Google account** choice showing only methods the account
   actually has (`GET /auth/linked-providers`); a dedicated current-password
   field for Password, or a `Verify with Google` box using the existing Google
   Identity button (a fresh ID token per click) for Google.

Both forms use a new opt-in `density="compact"` on `TextField`,
`PasswordField` and `NewPasswordForm`; other pages are unchanged.

### Request, pending and re-request

- `POST /api/auth/email-change/request` sends `newEmail` (trimmed, lowercased)
  plus exactly one of `currentPassword` / `googleCredential`. Only `202` is
  accepted (`expectedStatus`).
- After 202 the UI says only: "Request received. If this address can be used, a
  confirmation link may arrive there…". It never says an email was sent.
  Fields are cleared and the button pauses for the server's 60-second
  cooldown (a UI pause only; the server stays authoritative).
- `GET /api/auth/email-change/pending` is parsed field by field; only
  `maskedNewEmail` and the client-clock time left are shown. Expired intents
  disappear and are fetched again. There is **no Cancel button** (no API).
- "Request another link" focuses the New email field and asks for the address
  and fresh proof again; nothing is re-sent from stored data.
- Errors: 403 → "Your current password is incorrect." (password) or "This
  Google account isn't the one linked…"; 400 → check the email; 429; 503
  Google unavailable; network; others generic. Local checks: valid email, not
  the current email, password present.
- A rejected Google proof answers `401 INVALID_GOOGLE_CREDENTIAL`. The API
  client rethrows it as `GoogleProofRejectedError`, so `runAuthorized` does
  **not** end the session for it (an expired JWT still does).

## `/confirm-email-change?token=…`

- `captureEmailChangeLink()` runs in `main.tsx` before React mounts: it keeps
  the token in module memory and replaces the URL with `/confirm-email-change`.
  The page moves it into a ref and clears the module copy; it never reaches
  storage, router state, history state or logs. `index.html` already sends
  `no-referrer`.
- Opening the link does nothing. Signed out: "Sign in with your **current**
  email address (not the new one), then open the link from the email again."
  The token is not carried through login. Signed in: shows the signed-in
  address and a **Confirm email change** button; a "Sign out" option covers the
  wrong account.
- `204` → sign out locally (no logout call; the JWT is already revoked) and
  open Login with "Email updated. Log in with your new email address." A late
  204 cannot sign out a newer session.
- `400 INVALID_EMAIL_CHANGE_TOKEN` (also wrong account) and `409
EMAIL_CHANGE_UNAVAILABLE` discard the proof with safe text; 429, network and
  5xx keep it for retry; 401 ends the session and shows sign-in guidance.
- `/confirm-email-change` and `/account-deleted` were added to the
  never-return-to-after-login list.

## Data & Privacy → Danger Zone and Delete Account

`AccountDangerZone` is appended below the P5-07 export cards and privacy notice
(the export cards are unchanged). It explains irreversibility, that private
identity data is removed and that shared boards, cards, comments and activity
stay as "Deleted user".

The confirmation dialog (shared `Dialog`, new optional `icon` slot):

- states what is removed and what is kept, including that text written in
  shared content is **not** erased and that the old email gives no access back;
- requires exact, case-sensitive `DELETE` and one fresh proof (password field,
  or the Google button which only counts after DELETE is typed);
- sends `DELETE /api/users/me` with `{confirmation: 'DELETE', currentPassword |
googleCredential}` once; no optimistic sign-out; Escape/backdrop/Cancel are
  blocked while pending; nothing is sent on open or while typing;
- `204` → local sign-out and `/account-deleted` (a one-time signed-out page,
  redirected to `/` without the navigation flag);
- `409 ACCOUNT_DELETION_BLOCKED` → grouped blocker list with counts,
  "Showing 20 of 24" truncation, names rendered as text, and links:
  Personal-workspace boards → `/boards/:id/settings` (Move to workspace),
  sole-owner boards → `/boards/:id/members`, sole-admin Team workspaces →
  `/workspaces/:id/members`;
- 403, 400, 409 `CONFLICT`, 429, 503, network and 5xx keep the session and
  clear the password for a fresh retry.

`ApiError` now carries `blockers`, rebuilt by `parseDeletionBlockers` only for
409 `ACCOUNT_DELETION_BLOCKED`: unknown types, duplicates, bad counts and
malformed resources are dropped, extra fields are never copied and resources
are capped at 20.

## Profile

The "Email cannot be changed." hint is replaced by a link to
**Security → Change email**; there is no second email form.

## Files

- `lib/api-client.ts` (blockers), `features/auth/api.ts` (email change,
  pending, confirm, delete, `GoogleProofRejectedError`),
  `features/auth/email-change-link.ts`, `features/auth/components/ProofMethodChoice.tsx`,
  `features/auth/pages/{ConfirmEmailChangePage,AccountDeletedPage}.tsx`,
  `features/settings/security/{SecurityCard,ChangeEmailCard}.tsx`,
  `features/settings/data-privacy/{DangerZone,DeleteAccountDialog}.tsx`.
- Changed: `AccountSecurity`, `NewPasswordForm`, `TextField`, `PasswordField`,
  `Dialog`, `icons` (`GoogleGIcon`), `SecuritySettingsPage`, `DataPrivacyPage`,
  `ProfilePage`, `LoginPage`, `app/redirect.ts`, `app/routes.tsx`, `main.tsx`.

## Verification

- New tests: Change email (12), confirmation route and link capture (10),
  Danger Zone/delete dialog (13), blocker parsing (3); existing
  AccountSecurity and Settings tests updated for the second current-password
  field and the new card title.
- Mutation checks: 9/12 caught. The three survivors remove guards that are
  already enforced elsewhere (`runAuthorized` rejects a changed session; the
  dialog's own `close()` refuses while pending), so they are defence in depth.
- Full frontend suite with two workers: 152 files / 1,622 tests passed.
  `pnpm lint` and `pnpm build` passed; changed-file Prettier and
  `git diff --check` passed.
- **Real backend:** a throwaway PostgreSQL database (`kanban_p5_qa`, dropped
  afterwards), real Nest backend and the production build in Chrome: 30/30
  checks passed, covering #224 exports (own account JSON, archived Board CSV,
  Board JSON, member 403 / outsider 404) and #225 (wrong-password 403, real
  202, masked pending, bogus proof 400, token stripped, no auto-confirm, real
  204 email change, old JWT 401, login with the new email, delete 403, real 409
  blockers, real 204 deletion with tombstone and JWT 401). The mailbox step was
  simulated by writing a known proof hash into that throwaway database; mail
  delivery and real Google OAuth were **not** run.
- Visual QA on synthetic API responses (Google Identity replaced by a local
  stub button) at 1585×992, 1448×1086, 1440×900, 1280×800 and 390×844 in light
  and dark: see the [implementation evidence](../../design/screens/implementation/p5-account-security-privacy-ui/).
  No horizontal overflow.

## Known differences and follow-ups

- The Security page still scrolls: 111 px at the approved 1585×992 size (the
  mockup fits) because controls stay at 34 px for accessibility, more with a
  pending notice. Data & Privacy fits at 1448×1086 but scrolls at 1280×800 now
  that the Danger Zone is added.
- The issue's mockup copy says "Resend link"; the button says "Request another
  link" because there is no resend API.
- Comment/Activity components do not yet use the backend's `isDeleted`
  tombstone markers (#218 handoff); not in this issue's acceptance list.
- `ConnectedAccounts` (Google linking) can still sign a user out on a rejected
  Google token (existing behaviour, outside this issue).
