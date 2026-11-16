# MOB-19 Native Card Metadata

[Issue #278](https://github.com/duongkienvn/SE2026-T13/issues/278) · branch
`feat/mobile-card-metadata` · base `0f7eeb7`.
The base includes [MOB-15](https://github.com/duongkienvn/SE2026-T13/pull/275),
[MOB-16](https://github.com/duongkienvn/SE2026-T13/pull/276),
[MOB-17](https://github.com/duongkienvn/SE2026-T13/pull/277) and
[MOB-18](https://github.com/duongkienvn/SE2026-T13/pull/282).

## Mobile behavior

- Card Detail mounts the metadata component through the MOB-18 typed
  `CardMetadataSection`. It uses the canonical Card route and its existing
  navigation guards. Assignees come from the Card DTO, with names and avatars
  from the authorized Board roster. Workspace-only readers get a generic
  fallback for each assignment. The sheet searches loaded members and offers
  more pages.
- Assigned label chips come directly from the Card-label endpoint, including on
  archived Cards. In the sheet, users can load more Board labels, toggle Card
  assignments or open the Board catalog. Catalog edits validate trimmed names
  and six-digit colors. The server resolves case-insensitive collisions. Delete
  requires confirmation that the label will be removed from every Card using it.
- Start and due dates use native system date and time controls. The picker carries
  calendar and clock fields in UTC and the editor interprets them in the saved
  IANA timezone. The overlap picker names both offsets and makes the user choose.
  Gap times show a validation message. Dates are presented using the saved
  format and zone, with absolute screen-reader text and the shared due-status
  rule. Missing preferences default to UTC/ISO. A failed preference read offers
  Retry and displays dates with the available preferences or UTC.
- Save validates against the latest Card snapshot and checks the current zone
  before sending a non-null date. One PATCH field at a time preserves the other
  field. Clear stages `null` until Save. Cancel and unchanged drafts send no
  mutation. The server checks date ordering against its persisted counterpart
  under the Board transaction. Recoverable failures keep the draft. A changed
  zone or concurrently replaced date requires reopening the picker for review.
  Back protects unfinished date and label edits with Keep editing and Discard
  changes. Due status recomputes at the deadline, the next local minute and when
  the app foregrounds.
- Writes require an active writable Board and Card, are serialized per
  session/Board while pending, and use the existing REST session and resource
  fences. A missing assignment triggers reconciliation and a Board permission
  recheck. Logout, account change and confirmed revocation discard scoped state.
  Socket events refresh REST data, including catalog edits and membership
  removal. Board previews resolve missing label IDs using the shared paginated
  catalog. Filters keep their server semantics as associations change. Reads and
  invalidation leave unsent MOB-18 text intact.

## HTTP contracts used

All paths below are relative to `/boards/:boardId` on the authenticated API.

| Method and path                           | Body                                                       | Status and response                                         |
| ----------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| GET `/members?page=n&limit=100`           | —                                                          | 200, paginated Board members with `user.id` when authorized |
| POST `/cards/:cardId/assignees`           | `{userId}`                                                 | 201, Card assignee                                          |
| DELETE `/cards/:cardId/assignees/:userId` | —                                                          | 204                                                         |
| GET `/labels?page=n&limit=100`            | —                                                          | 200, paginated Board catalog                                |
| POST `/labels`                            | `{name,color}`                                             | 201, Board label                                            |
| PATCH `/labels/:labelId`                  | changed `name` or `color` or both                          | 200, Board label                                            |
| DELETE `/labels/:labelId`                 | —                                                          | 204, including association removal                          |
| GET `/cards/:cardId/labels`               | —                                                          | 200, `{cardId,labels}`                                      |
| POST `/cards/:cardId/labels`              | `{labelId}`                                                | 201, `{cardId,labels}`                                      |
| DELETE `/cards/:cardId/labels/:labelId`   | —                                                          | 204                                                         |
| PATCH `/cards/:cardId`                    | one of `startDate` or `dueDate` as UTC ISO instant or null | 200, Card                                                   |

`GET /users/me/preferences` supplies the session’s date format and timezone.
The current Board member DTO exposes the candidate assignment ID as
`member.user.id`. Backend currently caps a Board at 200 labels. Client pagination
also covers 251 labels in the synthetic contract and UI checks.
Board write access follows `canWriteBoard`. A guest with read access only sees
authorized metadata without edit buttons. The current Board contract grants
write access to explicit Board members on active Boards, including members who
are outside the Workspace, and has no separate Workspace guest flag.

## MOB-22 handoff

- `features/cards/metadata/queries.ts` exports `useBoardMetadataCatalogs` (MOB-15
  query keys and infinite queries), `useCardLabels` for selected Card detail,
  `useMetadataCard` (the MOB-17 Card query), `datePreferencesOptions` and
  `resolveAssignees`. Enable the member query only for a confirmed Board member.
  A denied roster is optional and yields an empty display catalog. Pending
  catalog pages affect name resolution separately from the actual assignment IDs.
- For Table rows reuse the Board catalog and MOB-15 preview batch `labelIds`.
  Paginate unresolved IDs via the shared catalog. Use `useCardLabels` only for
  the selected Card to avoid per-row requests. `queryKeys.cardLabels` is
  nested under the corresponding session, Board and Card.
- `MetadataLabel`, `AssigneeAvatar` and `CardDateValue` can render typed values
  in another surface. `describeCardDate`, `dueStatus` and `resolveWallTime`
  expose date formatting and timezone semantics. The standalone metadata API
  adapters and `runMetadataMutation` use the existing Mobile data layer.

## Visual reference and checks

Card chips sit above the compact assignee/date grid. The grid stacks at an
effective width below 360 dp. The manager sheets use MOB-02 safe-area surfaces,
grabbers, type ramp and controls. Long labels wrap and the label color is
carried by a tinted chip or swatch with a theme-aware text color. The Card
Detail mockup shows the due-date tile. The implementation groups Start and Due in
that tile.
Android and iOS use their system picker presentation. A Priority-style chip
appears only when the server returns that Board label.
[Card Detail reference](../../mobile/assets/04-card-detail.png) ·
[Board Detail and filters reference](../../mobile/assets/03-board-detail-and-filters.png).

Skills consulted and applied include Appllama’s native interaction guidance,
the Appllama usage guide, Kanvexa UI, Impeccable’s existing-surface workflow,
Kanvexa Verification and ponytail. The current session exposes no Appllama MCP,
so the approved references and MOB-02 implementation were the design sources.

### Automated Mobile

| Check                                                                                                                           | Result                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test apps/mobile/test/card-metadata.test.mjs` | PASS, 7/7                                        |
| `pnpm --filter @kanban/mobile test`                                                                                             | PASS, 260/260 Node and 249/249 Jest in 23 suites |
| `pnpm --filter @kanban/mobile lint`                                                                                             | PASS                                             |
| `pnpm --filter @kanban/mobile typecheck`                                                                                        | PASS                                             |
| `pnpm --filter @kanban/mobile bundle:android`                                                                                   | PASS, Hermes bytecode and 1,397 native sources   |
| Prettier on changed files and `git diff --check`                                                                                | PASS                                             |

### APK and device

The first [EAS preview](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/df09ba89-ad06-4bcc-a9eb-9d5b437bed9d)
installed on the Samsung SM-A507FN (Android 11). Its 93,360,600-byte APK at
`apps/mobile/apk/kanvexa-mob19-preview.apk` has SHA-256
`58EEEAA5FD80DF341FEBF7B0E23FB7AB9249F529D9952A2DDBE224AA07D7FD90`.
ZIP integrity, manifest, DEX, Hermes bytecode and both native picker modules
were verified. The Android calendar changed the due date to
`2026-11-18T09:00:00.000Z`, the time dialog opened at the saved 16:00 wall time,
and the start date remained `2026-11-15T09:00:00.000Z`.

The [second EAS preview](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/f9672b26-ff09-40cc-9329-c0f3525d2aa8)
added the Back prompts and due-status refresh. Its 93,364,056-byte APK at
`apps/mobile/apk/kanvexa-mob19-final-preview.apk` has SHA-256
`957D1B4FBD682D5F9984E65D52D8845721298C5C94495527CCFACABF043C8716`.
The same artifact checks passed and ADB installed it successfully. The staging
source matched 148 Mobile source files by SHA-256. Both previews use an isolated
HTTPS fixture over USB reverse.

| Samsung SM-A507FN, Android 11                         | Result                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 384 dp, 100% text, light                              | PASS. [Card Detail](../../design/screens/implementation/mob-19-card-metadata/android-card-detail-light.png)                                                                                                                                                                                                   |
| Member search, keyboard and hardware Back             | PASS. Add returned 201 and remove returned 204. The checkbox tracked the confirmed value, with Done above the keyboard. [Assignees sheet](../../design/screens/implementation/mob-19-card-metadata/android-assignees-keyboard.png)                                                                            |
| Date and time dialogs, draft protection and Clear     | PASS. Native Back returned to the sheet. Back on the changed draft showed Keep editing and Discard. Clear sent only `{dueDate:null}`. Due status changed at the deadline with Card Detail open. [Android picker](../../design/screens/implementation/mob-19-card-metadata/android-date-picker.png)            |
| Label assignment, create, rename and confirmed delete | PASS. The catalog delete removed the assigned label and the Board filters reflected the updated catalog. [Board filters](../../design/screens/implementation/mob-19-card-metadata/android-board-filters.png)                                                                                                  |
| 320 dp, 130% text                                     | PASS. The date row was reachable by vertical scrolling, and Save and Cancel were visible in the sheet.                                                                                                                                                                                                        |
| 320 dp, 160% text, dark, archived                     | PASS on the acceptance APK. Both avatar initials fit, the accessibility label retains the assignee's full name, and the archived Card displays metadata without write controls. [Dark read-only capture](../../design/screens/implementation/mob-19-card-metadata/android-card-detail-320-dark-read-only.png) |
| Live Board downgrade and revocation                   | PASS. A read-only downgrade retained authorized labels and hid write controls. Revocation cleared the Card title and labels.                                                                                                                                                                                  |

The second preview exposed a clipped second avatar initial at 160% text size.
The [acceptance preview](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/04bc46ae-ce81-492c-aeb6-c10aa2e9777f)
contains the scaling fix. Its 93,364,156-byte artifact at
`apps/mobile/apk/kanvexa-mob19-acceptance-preview.apk` has SHA-256
`6352B59B5DF2EDBE3E53A71BB0A207A7103C825D51D0536D729B4990FD40DEF8`.
ZIP, manifest, DEX, Hermes and native picker checks passed. The 148 staged
Mobile source files matched the workspace. ADB installed and tested
`tech.kanvexa.mobile.dev` version 0.1.0 (code 1) on the same phone. The narrow
dark capture verifies the correction, and the PID-scoped log had zero Android
runtime or JavaScript error entries. The phone's original display settings
were restored after testing.

The reference-width capture has the approved hierarchy of colored label chips,
two pale metadata tiles and the Description below. The required starting date
and visible management action make the tiles taller than the iOS illustration.
The filters keep the existing MOB-15 scrolling layout and sticky Apply action.
Android's calendar and clock inherit the device locale and native theme.

Assignee and label/date motion recordings were checked on the device. The
label/date pass had no PID-scoped Android runtime or JavaScript error entries.
Android `gfxinfo` reported 81 janky frames out of 102 rendered during recording
(median 21 ms and p95 117 ms). Sustained 60 fps was not demonstrated on this
device. iOS and a concurrent live Web/Mobile backend session are NOT VERIFIED.
Component checks use controlled DTO fixtures and the Mobile query/session
layers. DST and day-boundary tests exercise the shared date semantics and
matching Web wall-clock cases.
