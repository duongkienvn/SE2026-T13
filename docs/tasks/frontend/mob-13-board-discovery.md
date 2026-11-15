# MOB-13 — Native Board discovery

Implementation is committed on `feat/mobile-board-discovery`. On 2026-11-15,
the owner requested stopping further mobile verification and committing the
result. The unverified items below remain explicit delivery limitations.

The existing Boards tab uses the MOB-11 session-scoped Workspace selection. Its
All Boards query sends search, status and sort to the Workspace Board endpoint;
the Starred section uses the server's starred filter. Each list holds at most
five 20-item pages and supports moving back to earlier pages. Shared Boards use
the global Board list and only present explicit Board memberships outside the
joined Workspace directory; the directory is not fabricated for guests.

## Contracts and access

- `GET /workspaces/:id/boards` is membership-scoped. `memberCount: null` is
  withheld, not rendered as zero. List caches include session and Workspace.
- `GET /boards` supplies separately displayed guest Boards. Results are held
  until the membership snapshot and the global list have been rechecked.
- `POST /boards` sends name, Workspace, optional description and catalog
  preset. The server creates PRIVATE Boards. An uncertain result fences another
  creation until the user checks the directory.
- Metadata editing is offered only for an active explicit Board OWNER and is
  rechecked through `GET /boards/:id`. `PATCH /boards/:id` sends changed name
  and description only. Workspace ADMIN alone does not grant Board ownership.
- `GET /boards/background-presets` supplies choices, while the app renders
  vetted local artwork. `PATCH /boards/:id/background` includes the current
  `expectedVersion`; a `BACKGROUND_CONFLICT` refreshes the detail and asks the
  user to review and retry. Unrecognized future IDs use the artwork fallback.
- `PUT`/`DELETE /boards/:id/star` consume the 200 user-state response. A
  per-session/Board optimistic key serializes writes, rolls back on failure and
  invalidates the Board lists and Home. Starring requires read access, including
  an archived Board, but does not grant permission to edit Board content.
- The current canonical Board route is a guarded **coming soon** resource
  preview, not the P3 Board itself. It does not record `POST /views` for a
  preview; the future actual Board entry must record a view after authorization.

## Design and outstanding verification

The approved `docs/mobile/assets/02-boards-and-workspace-switcher.png` was
opened directly. The existing branded header, four-tab shell and Workspace
selector are reused; this change adds Starred, All, create, search, filters,
and Board actions. The first standalone APK was opened on a Samsung SM-A507FN
and its Boards screenshot was inspected against the reference. It showed an
overly tall Starred tile; commit `cafb4cb` reduced the artwork height and placed
the star alongside the title. Mobile typecheck and the focused Starred/duplicate
star component tests passed after that change. The corrected APK's appearance
was not verified before the owner stopped further checks. Complete visual parity,
320dp, theme/font-scale matrix, TalkBack and motion remain **NOT VERIFIED**.
Appllama MCP was unavailable, so external reference research and its full
motion workflow were not performed. The four requested design skills were read;
their available guidance was applied without replacing the approved design.
The implementation currently presents search, sort and status controls inline;
the reference does not show those controls. This is an unverified layout
adaptation for the issue's required server filters, not an approved visual
variance. The Board Detail route remains a coming-soon preview.

ADB was found at `D:/Tools/AndroidPlatformTools/platform-tools/adb.exe` and a
Samsung SM-A507FN running Android 11 was connected; an Android SDK was not
found in the checked locations. The existing package
`tech.kanvexa.mobile.dev.mob12qa` was removed with the owner's authorization. ADB
reverse forwards device port 3443 to an HTTPS proxy bound to host loopback; a
device TCP connection and certificate-verified host readiness check passed. Local
`gradlew.bat assembleRelease --offline` first failed on the sandboxed Gradle
cache lock; outside the sandbox it failed to establish a daemon loopback
connection, including with `--no-daemon`.

The owner subsequently authorized EAS cloud and explicitly approved source
upload after automatic review requested that clarification. The isolated QA
source includes a public test certificate trusted only for localhost and the
URL `https://localhost:3443/api`; private keys and test credentials are excluded.
The application's committed release security configuration is unchanged.
The first submitted build failed because staging's workspace root was wrong;
the corrected build
[`f1f7d404-74b9-451b-8322-ef0e6b0c710a`](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/f1f7d404-74b9-451b-8322-ef0e6b0c710a)
finished successfully. Its standalone APK is stored locally at
`apps/mobile/apk/kanvexa-mob13-qa.apk` (ignored), SHA-256
`9C8F54C6C1DC1373DA0AA406628FD0DB8F2698F647EADF1DDCECF24802CD45F7`.
ADB installed package `tech.kanvexa.mobile.dev` successfully. Real device checks
confirmed login, Board directory, unstar without navigation, PRIVATE Board
creation, owner rename, preset application and Android Back's dirty-form prompt.
The screenshot/XML evidence remains in ignored `apps/mobile/apk/mob13-*` files.
These checks used the original APK before the compact-tile correction.

The updated build
[`62bd04ac-a54c-4ef9-b8da-3d9077fe87b9`](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/62bd04ac-a54c-4ef9-b8da-3d9077fe87b9)
was still `IN_PROGRESS` at the last observation. Its artifact, installation and
visual result were not checked after the owner stopped mobile verification.
No production service was used.

## MOB-14 handoff

Reuse `BoardEditor` and the Board action entry point for name/description and
background. It obtains the actual Board role/capabilities before editing and
preserves the version-conflict flow. Archive/restore, visibility, moves,
members and other settings remain outside this task.

## Verification record

This is not a release sign-off. `pnpm --filter @kanban/mobile lint` and
`typecheck` passed before the last focused changes. One full mobile test run
passed 233 Node and 184 component tests before subsequent targeted edits;
those edits were checked with focused tests. `pnpm build` passed after the
implementation, including the Android Metro export and bundle verifier.
`pnpm lint` passed. `pnpm format:check` failed, reporting 1,422 files including
many untouched backend, frontend and CI files; an explicit check of changed
files passed before the final test/document edits. The default `pnpm test`
failed with loopback `EACCES` in backend tests and frontend timeouts under
concurrent load; it is not a pass.

An isolated PostgreSQL container on `127.0.0.1:55433`, with all 30 migrations,
and a local backend on port 3000 were started for this task. Two fake accounts
and a test Board were created only in that database. A local REST smoke test
passed owner/guest access, Workspace search/star, star PUT/DELETE 200 responses,
and background version conflict. A separate real Socket.IO client successfully
joined the Board and received its post-commit background-change event through
the certificate-verified local HTTPS proxy. This is backend/proxy evidence, not
proof that the native app reconciles the event. No production requests were made.

The owner also requested no further backend/frontend suite reruns; later work
was restricted to mobile verification and the local services it requires.
The final tile change passed mobile typecheck, focused Starred tests and scoped
ESLint. Full mobile suite/build reruns after that tile change were not performed.
Further mobile checks were explicitly waived for this delivery on 2026-11-15;
this does not turn the unverified scenarios into passing results.
