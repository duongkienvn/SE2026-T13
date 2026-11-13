# MOB-07 mobile testing and build tooling

Implemented on `feat/mobile-ci-tooling-v2`, created from main `a023686` with
MOB-04 present. The earlier MOB-07 branch and stash were preserved at the owner's
request to restart. This record describes verification on 2026-11-13, not a
production release. See [developer commands](../../mobile/testing.md).

## Implementation and contracts

The existing Jest Expo preset matches Expo 58 and React Native 0.88; React Native
Testing Library renders native components, while Node tests cover pure logic and
the real Metro/shared package boundary. No testing framework or application
dependency was added. The render helper supplies deterministic theme/safe-area
metrics. Native lifecycle fixtures implement the actual MOB-04 AppState/network
ports, retain current state and remove subscriptions. The SecureStore test
checks the real adapter's device-only options without a native keystore.

MOB-04's typed HTTP/data setup and MOB-05's fake clock/storage/session API are
reused. Existing `auth/session-integration.test.ts` supplies the generic socket
owner boundary and proves teardown on logout/expiry/account change; it is not a
real MOB-06 client. Existing Router tests cover tabs/back, malformed links and
no-private-content flash. Keyboard/sheet/disabled/loading/accessibility and
large-font behavior use the existing component tests. Fixtures never enter the
runtime, and no business screens or MOB-05/06 behavior were changed.

Mobile `build` now runs typecheck and Android Metro/Hermes export plus the existing
bundle audit. The required `Quality checks` job retains its name, frozen install
and all root gates. CI needs Node/pnpm only; there is one JS export and no EAS or
native SDK build on PRs. Preview explicitly selects the preview environment and
forces navigation preview to `0`. CD and `scripts/deployment/cicd.test.mjs` were
not edited; the existing mobile-only/mixed-change routing checks passed.

## Automated evidence

| Command/check                                     | Result                                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --prefer-offline` | PASS after registry access was allowed; lockfile unchanged                                                                                                      |
| `pnpm --filter @kanban/mobile lint` / `typecheck` | PASS                                                                                                                                                            |
| `pnpm test:mobile`                                | PASS: 102 Node tests, 67 component tests in 13 suites                                                                                                           |
| `pnpm lint`                                       | PASS                                                                                                                                                            |
| `pnpm build`                                      | PASS: shared, backend, frontend and Android Hermes bundle audit                                                                                                 |
| `pnpm test` (sequential final run)                | PASS: 1,283 backend, 1,677 frontend, 102 mobile Node and 67 mobile component tests                                                                              |
| `pnpm test:infra`                                 | PASS: 24 passed, 1 skipped because Bash was unavailable                                                                                                         |
| `pnpm format:check --end-of-line auto`            | PASS for the Windows CRLF checkout                                                                                                                              |
| Default `pnpm format:check`                       | Baseline CRLF warnings, including unchanged CI/CD files; stopped after 1,300 warnings while traversing the pre-existing untracked `.worktrees/` directory       |
| Changed-file Prettier and `git diff --check`      | PASS                                                                                                                                                            |
| Controlled failing typecheck/test                 | PASS: mobile build returned 2 for TS2322; mobile test returned 1 for a deliberate assertion; temporary files removed and mobile test/typecheck returned to PASS |
| Final tooling refinements                         | PASS: focused lifecycle/config tests, mobile lint/typecheck and changed-file formatting after preview environment/current-state fixture updates                 |

Local commands needed a temporary directory under the workspace to avoid Windows
sandbox temporary-file errors. HTTP/socket tests required loopback access. An
initial concurrent run timed out, and a shared rebuild interfered with one
backend test; the final sequential root run passed both. CI was not triggered
remotely. No database migration or production test was run.

## APK build and provenance

Local Gradle attempts exposed missing SDK packages, then Windows Hermes quoting
and CMake/Ninja paths over 260 characters. SDK Platform 37.0/36, Build-Tools
37.0.0/36.0.0, NDK 27.1.12297006 and CMake 3.22.1 were installed after the owner
accepted the Android SDK terms. Drive aliases and short native staging did not
produce a successful local APK. The owner then explicitly authorized an EAS
cloud **preview** build, overriding the original no-cloud constraint for this
acceptance run only.

[EAS build ab2c375e-05cc-494f-91ff-e53feab17ff3](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/ab2c375e-05cc-494f-91ff-e53feab17ff3)
finished successfully. Staging was exported from `c3eb7a8`; comparison of 2,512
tracked files found only the preview build configuration changed. Application
source, shared contracts, lockfile and branding match this branch's runtime.
Preview forced guard mode `0` and used reserved `.invalid` public URLs. Existing
development-app signing credentials were frozen; none were created or updated.
No store submission or production request occurred.

- Variant: Android release / EAS internal preview, app `Kanvexa` 0.1.0 (code 1).
- Application ID: `tech.kanvexa.mobile.dev`; compile SDK 37, target SDK 36.
- Local artifact: `apps/mobile/apk/kanvexa-mob07-preview.apk` (ignored by Git).
- Size: 91,718,071 bytes; ABIs: arm64-v8a, armeabi-v7a, x86 and x86_64.
- SHA-256: `915e3443e6bba650ac5d27d70f0cdb7cc1542fdcbcc12fe9f75e3fde0c68fd20`.
- `apksigner verify`: exit 0; APK contains `assets/index.android.bundle` and is
  not debuggable. This is not an Expo Go artifact.

## Android acceptance

Installed with `adb install -r` (`Success`) on `kanvexa_mob07_pixel8`, a Pixel 8
hardware-profile AVD, Android 16/API 36 x86_64, 1080x2400 at 420 dpi with WHPX.
Cold `am start -W` returned `Status: ok`. Expo Go was absent, adb reverse was
empty, no Metro listener was present, and cold launch also succeeded in airplane
mode. The app therefore runs with its embedded JS without Metro.

| Scenario                                                        | Result                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Approved native splash/logo and Sign in scaffold                | PASS; matches current source                                                                                 |
| Light/dark, font scales 100/130/160%, landscape, safe areas     | PASS; text remains visible within system bars                                                                |
| Cold Card link; warm Home/Search links                          | PASS: Sign in remains visible and private content does not render                                            |
| Malformed resource URL and untrusted external URL               | PASS: safe public destination                                                                                |
| Cold private link startup recording                             | Splash/public transition observed; final hierarchy is Sign in; no private content observed in sampled frames |
| Hardware Back                                                   | PASS: public root returns to Android launcher                                                                |
| Offline cold launch without credentials                         | PASS: signed-out public scaffold                                                                             |
| Crash buffer, ReactNativeJS error and AndroidRuntime error logs | Empty after the app scenarios                                                                                |

Screenshots and the machine-readable results are in
[`mob-07-mobile-testing/`](../../design/screens/implementation/mob-07-mobile-testing/).
Startup videos, UI dumps and raw empty error logs remain beside the ignored APK.
The emulator initially showed Quickstep/System UI ANRs; dismissing them and
force-stopping the launcher restored normal operation. Subsequent Kanvexa runs
and guard scenarios passed; this environment incident is not hidden as app QA.

Native scope limits: the current signed-out screen is a scaffold without an auth
form. Keyboard, modal/sheet and authenticated tab interactions are component/
Router-tested, **not claimed as device-tested**; there is no authorized route to
them without implementing later features or introducing an auth bypass. No
production account or fake runtime business data was used. Physical Android and
iOS were not tested; iOS requires macOS/Xcode.

## Changed files and commits

- `apps/mobile/package.json`, `eas.json`: lint/build integration and guarded preview.
- `apps/mobile/test/render-native.js`, `harness.component.test.js`: component harness.
- `apps/mobile/test/fixtures/native-lifecycle.ts`, `query/native-fixtures.test.ts`:
  deterministic MOB-04 lifecycle ports and cleanup checks.
- `apps/mobile/test/secure-store.component.test.js`, `tooling.test.mjs`: native
  adapter policy and build/profile regression checks.
- `apps/mobile/README.md`, `docs/mobile/development.md`, `testing.md`: developer setup.
- `docs/tasks/README.md`, this record and implementation screenshots/results:
  acceptance evidence and limits.

Eight local commits: `62ae1f4`, `6576962`, `9f5345d`, `faa2147`, `37fc9fa`,
`eb4c831`, `b9e8e8d`, and the final acceptance/tooling commit containing this
record (use `git log main..HEAD` for its current SHA). No push, PR, merge or deploy.
The pre-existing untracked `.worktrees/` directory was preserved.
