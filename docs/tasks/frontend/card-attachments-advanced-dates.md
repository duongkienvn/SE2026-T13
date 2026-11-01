# Card attachments and advanced dates UI

Local implementation record for
[#174 (P3-10)](https://github.com/duongkienvn/SE2026-T13/issues/174),
2026-11-01. Uses the merged [advanced dates](../backend/card-advanced-dates.md)
(P3-03), [attachment foundation](../backend/card-attachments-foundation.md)
(P3-05) and [private files](../backend/private-card-attachments.md) (P3-06)
contracts unchanged, inside [Card Detail V2](card-detail-v2.md). Whether
production storage is enabled is an operator decision; the UI handles both.

## Dates (rail)

- Shows Start and Due in the user's saved IANA zone and date format, plus the due
  chip from the shared `deriveCardDueStatus` (Overdue / Due today / Upcoming)
  with an explicit clock.
- **Edit dates** edits date + time inputs as a wall clock in the saved zone (not
  the browser's). `resolveWallClock` converts it to the instant(s) it names:
  a time skipped by spring forward is refused; a time repeated by fall back asks
  "First (UTC−04:00) / Second (UTC−05:00)". Bare days and offset-free strings are
  never sent. Picking a day fills 09:00 (start) / 17:00 (due).
- One PATCH carries both changed dates; unchanged dates are omitted, cleared ones
  sent as `null`; start after due is refused before sending and
  `CARD_DATE_RANGE_INVALID` is mapped. The draft keeps the zone it was entered
  in, so a preference change while editing cannot shift it.
- The old `dueDateFromInput` (local end-of-day) helper is removed.

## Attachments (main column)

- Paged ACTIVE list (5 per page, numbered pages), kind icons, size/type or link
  host, time. Links open with `target="_blank" rel="noopener noreferrer"` and
  name their host; only HTTPS links without credentials are rendered as links.
- **Add → Add link:** HTTPS check, optional name, one UUID `Idempotency-Key` per
  intended link, reused when retrying after an error.
- **Add → Upload file:** PNG/JPEG/WebP/PDF/TXT, 1 B–10 MB checked first; then
  intent (own idempotency key) → transfer → `complete`, shown as Preparing /
  Uploading / Checking. **Attached** appears only after the server's ACTIVE
  answer. `ATTACHMENT_UPLOAD_BUSY` is retried with backoff; terminal errors
  cancel the intent and a retry starts a new key; Cancel, unmount or session
  change abort the transfer and cancel the intent. 503
  `ATTACHMENT_FILES_NOT_AVAILABLE` says so honestly and hides Upload while links
  keep working. The grant is held only inside the upload function.
- **Transfer target:** S3 gets every returned field and the file last, HTTPS
  only, `credentials: 'omit'`, no token. The memory driver (dev/test) must be an
  API-origin path for this exact upload and gets the token.
- **Download / preview:** bytes are fetched from `GET …/:id/file` with the token
  (never a public `<a>`/`<img>`), turned into a short-lived blob URL and revoked
  after download or on unmount. Only PNG/JPEG/WebP preview inline; PDF and text
  are download-only.
- **Edit / Remove:** PATCH and DELETE send `expectedRevision`; a revision
  conflict is explained and the list refetched. Read-only viewers can open and
  download but see no Add/Edit/Remove.

## P3-13 handoff

`DueStatusBadge`, `useDatePreferences`, `formatCardInstant`, `cardDueStatus`
and `attachmentKeys` are reusable for previews. `KanbanCard` still uses its old
overdue check; P3-13 owns that tile.

## Verification

- `card-dates.test.ts` (7: zones, DST gap/fold, invalid days, round trips in
  UTC±, formats, due status), `CardAttachments.test.tsx` (13), date cases in
  `CardDetailV2.test.tsx`. Mutation checks caught: saved zone ignored, start >
  due allowed, ambiguous time guessed, fresh key on link retry, success before
  verification, S3 cookies sent.
- Real backend + Chrome (memory driver, synthetic PNG): upload reached ACTIVE,
  preview used a blob URL, due 18:30 in Asia/Ho_Chi_Minh saved as 11:30Z.
- Screens in
  [`implementation/card-attachments-advanced-dates/`](../../design/screens/implementation/card-attachments-advanced-dates/).

## Risks

- S3 transfer was verified only with unit tests (no real bucket used).
- `datetime` inputs follow the browser's locale display (12/24 h).
