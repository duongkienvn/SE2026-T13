# MOB-18 — Native full-screen Card Detail

Issue: [#274](https://github.com/duongkienvn/SE2026-T13/issues/274). Branch:
`feat/mobile-card-detail`. Implementation, Mobile checks and Android phone verification are recorded below;
this record is not a native-device or release sign-off.

## Scope and source evidence

- Base: `main` at merge `7f49c9c`. GitHub verified MOB-15 #271 / PR #275,
  MOB-16 #272 / PR #276 and MOB-17 #273 / PR #277 merged. MOB-13 is integrated
  through PR #270. No pre-existing uncommitted work was present.
- MOB-14 #263 is still open and its native settings/lifecycle module is absent
  from this base. This screen consumes the implemented Board GET capabilities,
  archive and access-fencing contracts; it does not implement MOB-14 settings.
  Recheck those transitions when MOB-14 integrates.
- Read AGENTS/workflow, Mobile Roadmap MOB-18 and sections 11–13, Design Spec
  4.4/5–7/9, Architecture Card and Board contracts, network/realtime and MOB-02.
  Inspected backend Card controller/service/response/update DTOs, Column decoder,
  Board/member access and Web text editor/normalization/draft behavior.
- Directly viewed approved [Card Detail](../../mobile/assets/04-card-detail.png)
  and [Board context](../../mobile/assets/03-board-detail-and-filters.png).
  Applied appllama-app-design-skill, appllama-usage, kanvexa-ui, impeccable,
  ponytail and kanvexa-verification. Appllama MCP is unavailable. CodeGraph's
  index exists, but neither its CLI nor an MCP tool is available; used source
  reads after the CLI failure.
- No backend/Web/schema/shared-package change, new dependency, global store,
  additional route, or MOB-19/20/21/22/26 business feature is included.

## Direction contract

The approved Group 04 is the composition authority: compact Back + official K +
Card details/Board subtitle/overflow; Board › Column; wrapped title; real
metadata; description surface; ordered extension regions; contextual footer.
Use the existing MOB-02 semantic palettes, type ramp, 4-point spacing, surfaces,
buttons, safe area and native keyboard/scroll primitives. Preserve the incumbent
four tabs and push Card Detail above them. No alternative visual world is being
introduced. Missing optional features have no fake controls or counts.

## Implementation and ownership

- Thin canonical route:
  `apps/mobile/src/app/(private)/boards/[boardId]/cards/[cardId].tsx`.
  Both route IDs must pass the existing UUID parser before a protected request.
- `features/cards/detail/CardDetailScreen.tsx`: Board/Card entry guards,
  query verification, draft/security lifetime and navigation prevention.
  `CardDetailContent.tsx` owns parent Column resolution with MOB-16
  decoder/pagination, chrome and the single scroll.
  It reuses `cardOptions`, `runCardMutation`, `useCardLifecycle` and
  `CardActionsSheet`. The former resource placeholder is removed.
- `draft.ts` / `useCardDraft.ts` / `CardTextEditor.tsx`: one shared inline editor
  for title or description. Overflow Rename enters that same editor; Board's
  existing quick rename remains backward compatible.
- `useDraftNavigation.ts` uses the installed Expo Router's `usePreventRemove`
  and its `repeat`/disable API. Warm app links may push without removing a route,
  so the existing incoming-link dispatcher can return the held current path;
  the user chooses Keep editing/Discard before the target is pushed.
- Card Detail Restore closes its existing sheet rather than opening the Board's
  archived list; the MOB-17 hook's default Board behavior remains intact.
  An uncertain Duplicate's Review board refreshes the unfiltered list through
  MOB-17 and returns to the existing Board route for inspection.

## Stable section contract and handoff

All exports live in `features/cards/detail/sections.tsx`:

```ts
type CardDetailContext = {
  boardId: string;
  cardId: string;
  identity: SessionIdentity;
  board: KanbanBoard;
  card: Card;
  readOnly: boolean;
  canEdit: boolean;
  active: boolean;
  refreshCard: () => Promise<unknown>;
};
type CardDetailSectionProps = { context: CardDetailContext };
type CardDetailSections = {
  Metadata?: ComponentType<CardDetailSectionProps>;
  Checklists?: ComponentType<CardDetailSectionProps>;
  Attachments?: ComponentType<CardDetailSectionProps>;
  Comments?: ComponentType<CardDetailSectionProps>;
};
```

Named mounts: `CardMetadataSection`, `CardChecklistsSection`,
`CardAttachmentsSection`, `CardCommentsSection`. Each accepts `{context, section?}`.
Metadata defaults to real read-only assignees/start/due. Other missing sections
return null. An independent render-error boundary offers section Retry without
replacing the root. `CardSectionFrame` supplies a consistent section heading.
Async loading/error/empty/readonly belongs to the mounted feature's own query.
`active` gates queries when the route is not focused; `canEdit` is an affordance,
never server authorization. Do not replace the route's Board/draft owner.

Query factories are the existing `infrastructure/query/keys.ts` exports:

| Data                       | Key factory                                        |
| -------------------------- | -------------------------------------------------- |
| Board authority            | `queryKeys.board(identity, boardId)`               |
| Card base                  | `queryKeys.card(identity, boardId, cardId)`        |
| Columns, same Board        | `queryKeys.columns(identity, boardId)`             |
| Authorized member names    | `queryKeys.members(identity, boardId)`             |
| MOB-19 Board label catalog | `queryKeys.labels(identity, boardId)`              |
| MOB-20 checklists          | `queryKeys.checklists(identity, boardId, cardId)`  |
| MOB-21 attachments         | `queryKeys.attachments(identity, boardId, cardId)` |
| MOB-26 comments            | `queryKeys.comments(identity, boardId, cardId)`    |

Per-Card label assignments do not yet have a dedicated factory; MOB-19 should
use a child key under the existing Card key and coordinate its invalidation.
Every key
starts with `['mobile', 'private', userId, generation]`. Forward captured identity,
resource key and cancellation signal through MOB-04. Invalidate child keys for
child changes, not the entire Card root. The fixture mount/error tests in
`test/card-detail.component.test.js` demonstrate the optional component contract.
`test/fixtures/card-detail-sections.ts` provides a compile-checked downstream
section example with `satisfies CardDetailSections`.

- MOB-19 owns editable metadata/catalogs; replace Metadata only.
- MOB-20 owns checklist section/query behavior.
- MOB-21 owns authorized attachment transfer, picker and cleanup.
- MOB-26 owns comments/mentions and composer.
- MOB-22 must open this existing Card route.

## Draft, concurrency and privacy

- Local component state only, keyed by user + generation + Board + Card. No
  AsyncStorage/offline persistence or promise of survival after process death.
  The entry owns the draft above the transient loading/recheck surface: a Board
  archive hint temporarily hides protected UI while MOB-06 verifies access,
  then a still-authorized read-only Card regains its copyable draft. Confirmed
  revoke, denied child and session loss clear it. Socket fixture tests exercise
  this through the real MOB-06 controller, not direct UI state replacement.
- Baseline captures the exact server field; edit input is initially exact.
  Description normalization matches Web: trim, whitespace-only → explicit null.
  Title ≤120 and description ≤2,000 Unicode code points; invalid/no-op values
  never issue PATCH. Save sends only the edited field (and MOB-17's existing
  `expectedTitle` for title). Cancel never issues PATCH.
- Dirty state compares normalized input. Conflict compares the edited field
  against its exact baseline, not `updatedAt`. Load latest replaces only that
  field; Keep mine and save explicitly acknowledges its currently seen value.
  A pre-save GET catches a newly changed field before PATCH. Description has no
  backend CAS; a write racing after that GET remains possible and is not claimed
  to be prevented. A second change requires a new acknowledgement.
- One synchronous pending lock spans read/write; input and duplicate submissions
  are blocked. Failed mutations retain draft. Success closes the editor only
  after a matching response value, current identity and resource epoch checks.
  MOB-17 reconciles Board lists, previews, Home, Tasks and Search.
- Board/Card archive and write downgrade keep a copyable mounted draft but
  block mutation. Revoke, unavailable child, 401, logout and account switch
  remove protected content and fence late responses through MOB-05/06. A child
  403/404 is not a Board grant/revoke decision; MOB-06 probes Board separately.
- Descriptions render as native selectable Text, preserving newlines, with no
  HTML/WebView, evaluated markup or automatic link execution.

## Visual comparison and deliberate variances

| Approved element                     | Implementation / evidence                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Back, official K, compact header     | Official MOB-02 asset, semantic text and 48 dp controls verified on Android                                                                          |
| Board › Column and wrapped title     | Verified GET values, neutral Column unavailable fallback                                                                                             |
| Assignees and dates                  | Real DTO values; names/avatars only from authorized Board member catalog. Workspace-only reader sees IDs, without requesting restricted roster       |
| Description panel/edit               | MOB-02 surface, inline multiline editor, explicit Save/Cancel and conflict choices                                                                   |
| Lower rich sections                  | Typed mounts in Checklists → Attachments → Comments order; omitted until their feature exists                                                        |
| Contextual footer                    | Real Move and Edit card; no unsupported Activity/star/Upload/Comment controls                                                                        |
| Light/dark/system                    | Existing semantic palette; inherited MOB-02 contrast corrections                                                                                     |
| Safe area/keyboard/320dp/large fonts | Android verified keyboard, safe areas, 320 dp and 160% text. Metadata stacks below an effective width of 360 dp (window width divided by font scale) |

The PNG's sample labels, people, priority/status, checklist progress, files and
counts are illustrative. They are not shipped as CardResponseDto fields. No
approved reference was overwritten or bundled as the app UI.

## Verification evidence

Implementation was completed before the main Mobile acceptance run. Commands
are scoped to Mobile; no backend/frontend/root test, lint or build was executed.
The machine-readable results are in
[mobile-checks.json](../../design/screens/implementation/mob-18-card-detail/mobile-checks.json).

| Check                                           | Actual outcome                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/mobile test`             | PASS: Node 253/253; Jest 243/243, 23 suites                                                                            |
| Focused draft/decoder/PATCH Node test           | PASS: 4/4                                                                                                              |
| Focused Card Detail + navigation-intent Jest    | PASS: 30/30                                                                                                            |
| `pnpm --filter @kanban/mobile lint`             | PASS                                                                                                                   |
| `pnpm --filter @kanban/mobile typecheck`        | PASS                                                                                                                   |
| `pnpm --filter @kanban/mobile bundle:android`   | PASS: Hermes bytecode, 1,373 native sources, shared ESM and official logo                                              |
| `pnpm exec prettier --check -- <changed files>` | PASS on changed files                                                                                                  |
| `git diff --check`                              | PASS                                                                                                                   |
| Android USB                                     | Samsung SM-A507FN, Android 11. All Android previews installed and exercised. Layout and label retests PASS.            |
| iOS                                             | NOT VERIFIED: no available iOS simulator/build on this Windows host                                                    |
| Real Web/native concurrent backend session      | NOT VERIFIED; Mobile integration uses independently controlled DTO responses and real MOB-06 Socket.IO client behavior |

Failures were fixed and rerun: RN ScrollView ref type, a test console declaration,
REST-authorized writes incorrectly depending on a live socket snapshot, optional
native test introspection, child 403/404 content becoming visible again after
MOB-17 reconciliation, and old incoming-link subscribers returning a numeric
Array.push result. Held paths now require a string accepted by the canonical
route parser. The full Mobile suite initially caught the last regression and
passed after the fix. A sandbox Hermes failure was environmental; the unchanged
Mobile bundle command passed outside that sandbox. Development-only Expo Router
ROUTE_NAMES_CHANGED warnings occur in router fixtures; the final tests pass. After the single-label
fix, Mobile Node passed 253/253. The concurrent Jest run failed one
Workspace Discovery star assertion outside Card Detail (242/243). Running
`pnpm --filter @kanban/mobile exec jest --runInBand` on the same source passed
243/243, with 23 suites. Lint, typecheck and Android Metro/Hermes passed.

Local raw logs/results are retained under ignored `apps/mobile/apk/mob18-*`.
Native rendering, gestures, keyboard geometry and motion are separate evidence;
component tests and a Hermes export are not claimed as device verification.

## APK and native acceptance

The first Android EAS preview
[24f5023f-f6f4-47be-9a3e-07907ca260d1](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/24f5023f-f6f4-47be-9a3e-07907ca260d1)
completed and installed through ADB on the owner's Samsung SM-A507FN, Android 11. The downloaded `apps/mobile/apk/kanvexa-mob18-preview.apk` is 92,729,568
bytes with SHA-256
`DA7380636B21B0B27C6533682927A343A068699F0CD29008EABC89340503B03A`.
ZIP integrity, Android manifest, DEX and embedded Android JS bundle passed.
Android reported package `tech.kanvexa.mobile.dev`, version 0.1.0 (code 1).

The first preview verified cold scheme link and sign-in, Board/Column/Card reads,
keyboard-visible input, the hardware Back prompt, draft retention, Socket.IO
field conflict, exactly one PATCH after explicit confirmation, 320 dp at font
scale 1.6, archived read-only, Restore and socket access revocation. It also
revealed that vertically stacked metadata rendered at half available width and
that an unusually long title could push the archive notice below the fold.
The source now stretches metadata to full width in its stacked layout and shows
the notice immediately above the title. Corrective preview
[bed1f994-a30b-4af4-b886-68be65c2c837](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/bed1f994-a30b-4af4-b886-68be65c2c837)
completed and installed on the same device. The final file
`apps/mobile/apk/kanvexa-mob18-layout-preview.apk` is 92,729,568 bytes with
SHA-256 `A041CC376B13FB8E0697ECC083CA73B266132B2F33806E7EE36F2CD0C8A8D908`.
ZIP integrity, manifest, DEX, embedded bundle and ADB install passed. All Mobile
checks passed again, including the 253 Node and 243 Jest tests and Android
Hermes export. The corrective APK also passed authenticated detail entry,
keyboard focus, hardware Back and draft discard. PID-scoped app error logs
were empty.

The corrective layout build screenshots show the [384 dp light overview](../../design/screens/implementation/mob-18-card-detail/android-card-detail-light-final.png),
[320 dp dark archived state at 160%](../../design/screens/implementation/mob-18-card-detail/android-card-detail-320dp-final.png),
[full-width stacked metadata](../../design/screens/implementation/mob-18-card-detail/android-card-detail-320dp-metadata-final.png),
and [long description after scrolling](../../design/screens/implementation/mob-18-card-detail/android-card-detail-320dp-scroll-final.png).
Android UI bounds confirmed the two metadata labels share an 858 px
content width at 320 dp and that the archived notice precedes the long title.
Dates use the signed-in user's time zone preference and identify a device time zone fallback. The compact Android
header uses the existing semantic surfaces and Android back icon. Section
spacing adapts to the scaled text. The footer has the implemented Move
and Edit card actions from the approved composition. The display varies
from the iOS mockup in system chrome, text wrapping, and omission of
out-of-scope checklist, attachment and comment controls.

The Android finish review inspected the approved reference and real screenshots.
It verified both layout corrections and found a repeated Description label when
editing. The reading heading now appears during reading only. Editing and
conflict use the existing input label, which still supplies the accessible name.
Final recapture build [77d0692c-6b9f-4106-8b13-6d4e413d7cd1](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/77d0692c-6b9f-4106-8b13-6d4e413d7cd1)
completed, downloaded and installed on the same device. The standalone APK
`apps/mobile/apk/kanvexa-mob18-final-preview.apk` is 92,729,592 bytes with
SHA-256 `D02AA3CDA6051663BABD18C610C74391531E990BB0CB1A563D2012C516CE8117`.
ZIP integrity, manifest, DEX, the embedded Android JS bundle and ADB
installation passed. All 140 Mobile TS/TSX files matched the build staging
after formatting. Native UI inspection confirmed one visible label and one
accessible Description input in edit and conflict states. Android Back still
prompts, Keep editing retains the draft, and conflict confirmation sent one
PATCH. No AndroidRuntime or ReactNativeJS error lines were found for the final
app process. The finish reviewer marked the listed Android fix resolved.

On the first preview, a dirty warm link held its destination until the user
discarded the draft. Returning from Card Detail restored the Board's Mine filter
and horizontal position within one physical pixel. Native Move updated the
breadcrumb, Duplicate received HTTP 201, and Archive exposed read-only and
Restore. An unchanged Save made zero
PATCH requests. Clearing the description made one PATCH and displayed No
description. Fixture HTTP 429 retained the typed text and sent no automatic
retry. Explicit Save after the cooldown succeeded. The fixture 401 returned to
sign-in. PID-scoped AndroidRuntime/ReactNativeJS error log contained zero lines.

Final preview evidence: [keyboard](../../design/screens/implementation/mob-18-card-detail/android-keyboard.png),
[hardware Back prompt](../../design/screens/implementation/mob-18-card-detail/android-discard.png),
and [conflict](../../design/screens/implementation/mob-18-card-detail/android-conflict.png).
The local `apps/mobile/apk/mob18-runtime/android-editor-final.mp4` capture was
sampled across the overview, keyboard focus, prompt and conflict states.
Transition timing and Reduce Motion were not measured.

The ignored QA source snapshot contains only Mobile/shared build inputs, with
API `https://localhost:3443/api`, a public localhost test certificate and a
localhost-only Android trust override. No private key, login token, environment
secret, backend source or database was uploaded. The committed app config and
release trust policy are untouched. All 140 Mobile TS/TSX source files compare
equal after formatting against the checked implementation; the only intentional
build configuration differences are the QA endpoint and localhost trust plugin.
The final preview also matched all 140 Mobile TS/TSX files after formatting.

Native tests use a loopback Node Mobile DTO fixture service, existing Mobile test
fixtures, in-memory state and Socket.IO hints, forwarded through ADB. This is not
a real backend/database/Web deployment and does not prove server persistence,
locking, authorization or cross-device Web interoperability. It allows native
layout/navigation/keyboard/draft and HTTP failure paths to be tested without
violating the owner's prohibition on backend suites or production. The service,
keys, requests and build staging remain in ignored `apps/mobile/apk/`.

## Acceptance checklist

| Original requirement                                                          | Evidence                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Authorized canonical Board/Column/Card deep link; wrong IDs and parent fenced | PASS Mobile decoder/router tests and signed-in Android fixture route                                                              |
| Group 04 single scroll, real metadata/description, no fictional controls      | PASS Android 384 dp light and 320 dp dark captures compared to Group 04                                                           |
| Description/title Save/Cancel/no-op/null/max/pending/errors                   | PASS Mobile tests and Android description save/no-op/null/429                                                                     |
| Field conflict with explicit keep/load, unrelated updates retained            | PASS Mobile tests and Android Socket.IO fixture conflict with one PATCH after Keep mine                                           |
| Dirty Back/tab/deep link; keyboard, narrow/large type/theme                   | PASS Mobile Router, Android hardware Back and warm link, keyboard, 320 dp/160%, light/dark system theme. iOS gesture NOT VERIFIED |
| Archive, ACL, revoke, logout/401/account generation and late results          | PASS Mobile tests and Android archive, Restore, socket revoke and 401 with fixture                                                |
| MOB-17 Move/Duplicate/Archive/Restore and preserved Board context             | PASS Mobile adapter and Android action tests. Returning retained Mine and horizontal scroll within 1 px                           |
| Typed independently mounted/omitted/error-isolated sections                   | PASS component fixtures and compile-checked section contract                                                                      |

## Commits and limits

- `f09d539` implements the full-screen flow and automated checks.
- `d75d4bd` corrects metadata width and archive notice placement.
- `8a54b96` keeps a single visible Description label and asserts the accessible input.
- The documentation commit records the verified APKs, screenshots and test results.

iOS, the iOS back gesture and live TalkBack/VoiceOver interaction are NOT
VERIFIED. The Android UI hierarchy and Mobile tests verify the input's
accessible name.
OS-level HTTPS App/Universal Link association remains MOB-46. MOB-14 settings
integration remains pending that issue. The Android fixture is evidence for the
Mobile client, while live backend/Web interoperability was NOT VERIFIED.
The branch contains local commits only.
