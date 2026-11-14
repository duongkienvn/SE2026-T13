# MOB-13 — Native Board discovery (work in progress)

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
and Board actions. **Visual parity is not verified**: no current APK screenshot
or device comparison exists. In particular, layout, 320dp, typography,
touch targets, theme, font scaling, keyboard and Android Back need real-device
review against the approved image before acceptance. Appllama MCP was not
available, so its external reference and motion workflow was not performed.
The implementation currently presents search, sort and status controls inline;
the reference does not show those controls. This is an unverified layout
adaptation for the issue's required server filters, not an approved visual
variance. The Board Detail route remains a coming-soon preview.

ADB was found at `D:/Tools/AndroidPlatformTools/platform-tools/adb.exe` and a
Samsung SM-A507FN running Android 11 was connected; an Android SDK was not
found in the checked locations. The existing package
`tech.kanvexa.mobile.dev.mob12qa` was observed and has not been removed. ADB
reverse forwards device port 3443 to an HTTPS proxy bound to host loopback; a
device TCP connection and certificate-verified host readiness check passed. Local
`gradlew.bat assembleRelease --offline` first failed on the sandboxed Gradle
cache lock; outside the sandbox it failed to establish a daemon loopback
connection, including with `--no-daemon`. No MOB-13 APK was built or installed.
No production service was used. The user later authorized EAS cloud; the
automatic approval review rejected the source upload because explicit approval
for exporting the private repository payload was not recorded. The QA build
archive is prepared separately, with a public test certificate and an explicit
loopback API URL; its private key and test accounts are excluded. No EAS build
was started and no application was removed from the device at this point.

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

Record final command outcomes and device screenshots after verification. The
feature must not be considered complete while the required native visual/device
checks are unavailable.
