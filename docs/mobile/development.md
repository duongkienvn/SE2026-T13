# Kanvexa Mobile development — Windows and Android

This guide describes the current mobile foundation. Navigation, session and REST/Query infrastructure now exist; feature screens remain separately scoped. See the
[MOB-01 record](../tasks/frontend/mob-01-expo-foundation.md) for verification evidence.

## Pinned foundation

| Dependency                                    | Version / policy                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Expo SDK / `expo`                             | 58 / **58.0.23**, stable                                                                    |
| React Native                                  | **0.88.1**                                                                                  |
| React                                         | **19.3.0**                                                                                  |
| Expo Router                                   | **58.0.30**                                                                                 |
| Expo Metro / underlying Metro / Metro runtime | **58.0.0** / **0.87.1** / **58.0.17**                                                       |
| Expo Constants / Linking / Status Bar         | **58.0.15** / **58.0.16** / **58.0.4**                                                      |
| Native safe-area-context / screens            | **5.11.1** / **4.30.1**                                                                     |
| Mobile TypeScript / React types               | **6.0.3** / **19.3.0**; existing workspaces keep TypeScript 5.9.3                           |
| pnpm                                          | **10.18.3**, repository `packageManager`; isolated linker                                   |
| Node                                          | Use **22.17.0** (tested here) or a compatible Node 22 release ≥22.13.0; CI uses **22.13.0** |

The dependency set follows Expo 58.0.23's `bundledNativeModules.json` and the
official blank TypeScript template 58.0.32, with Expo Router installed according to
its manual installation guide. Mobile uses the template's TypeScript 6 version
in its isolated pnpm workspace; existing applications keep their own compiler. Dependencies
are exact pins in `apps/mobile/package.json`; pnpm fixes the transitive graph.

Sources: [SDK 58 release](https://expo.dev/changelog/sdk-58),
[Expo SDK compatibility](https://docs.expo.dev/versions/latest/),
[Router installation](https://docs.expo.dev/router/installation/),
[Expo pnpm monorepos](https://docs.expo.dev/guides/monorepos/).

## Install from PowerShell

Use the repository's Node requirement and pnpm version. Do not install a global
legacy `expo-cli`, change the global linker, or run npm/yarn install in the app.

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
Copy-Item apps/mobile/.env.example apps/mobile/.env
pnpm dev:mobile
```

The environment file is optional for MOB-01. Since MOB-05 the session reads
`EXPO_PUBLIC_API_BASE_URL` to verify a stored login with `GET /users/me`; it
sends nothing when no credential is stored. Non-HTTPS URLs are accepted only for
loopback, `10.0.2.2` and private-LAN hosts in development builds
([session guide](session.md)). `EXPO_PUBLIC_SOCKET_URL` is still unused. These values will be embedded in client code when used.
Never put JWTs, passwords, server keys, signing credentials or other secrets there.

## Android emulator on Windows

1. Install Android Studio. In SDK Manager install Android SDK Platform **37.0**,
   Android SDK Build-Tools, SDK Platform-Tools, Android Emulator and an API 37
   Google APIs emulator image suitable for your machine. Enable hardware
   virtualization in firmware and the Windows hypervisor support required by the
   emulator. Follow the [Expo Android setup guide](https://docs.expo.dev/workflow/android-studio-emulator/).
2. Set the user environment variable `ANDROID_HOME` to the actual SDK directory
   (normally `%LOCALAPPDATA%\Android\Sdk`). Add its `platform-tools` and `emulator`
   directories to your user `Path`. Reopen the terminal after persistent changes.
3. Create and start a phone in Android Studio **Device Manager**. Confirm
   `adb devices` shows an emulator in the `device` state.
4. Install/open **Expo Go compatible with SDK 58**. Expo CLI can install the
   compatible Android client on the emulator; older SDK builds are also available
   from [Expo Go downloads](https://expo.dev/go).
5. At the repository root run `pnpm dev:mobile:android`, or `pnpm dev:mobile` and
   press **a**. Reload JavaScript with **r** in the Metro terminal.

For the current PowerShell session only, SDK paths can be configured as follows:

```powershell
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"
adb devices
pnpm dev:mobile:android
```

Expo Go does not require a local Gradle/JDK compile. To compile the app's native
debug binary instead, install **JDK 17**, set `JAVA_HOME` to that JDK, install the
SDK/build tools required by the generated Gradle project, and run:

```powershell
pnpm --filter @kanban/shared build
pnpm --filter @kanban/mobile android:native
```

This invokes `expo run:android` and generates ignored `apps/mobile/android/`
through Expo Continuous Native Generation. It is a local debug build, with no
EAS account, cloud build or store submission. Use `--device` to select an attached
phone. Native source and machine paths are generated locally; change Expo config
and config plugins rather than editing generated files as durable source. See
[local debug builds](https://docs.expo.dev/guides/local-app-development/).

## Physical Android and host addresses

Enable Developer Options and USB debugging, connect the phone, approve its USB
debugging prompt and check `adb devices`. For Expo Go, the phone and computer can
also share a trusted LAN: run `pnpm dev:mobile` and scan Metro's QR code. Allow
Node/Metro on the Windows private-network firewall (normally port **8081**). Avoid
guest Wi-Fi client isolation/VPN routes that prevent phone-to-computer traffic.

| Target                                   | Future API base URL             | Meaning                                                                         |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| Android Studio emulator                  | `http://10.0.2.2:3000/api`      | Android emulator's alias for the host PC                                        |
| Physical phone on LAN                    | `http://<PC-LAN-IPv4>:3000/api` | Use your PC's actual private IPv4; backend must listen on a reachable interface |
| USB with `adb reverse tcp:3000 tcp:3000` | `http://127.0.0.1:3000/api`     | Device port forwarded to host; development only                                 |
| iOS simulator on a Mac                   | `http://localhost:3000/api`     | Mac host; not the Windows PC                                                    |

The corresponding socket URL omits `/api`. `localhost` on a phone refers to that
phone. Metro's **8081** URL is separate from backend **3000**. A Metro tunnel does
not expose the backend. Use local/staging services; no production endpoint or
account is needed. MOB-04 owns networking and native cleartext/TLS behavior.

## Commands and workspace boundaries

Run these from the repository root:

| Command                                                        | Behavior                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`                                                     | Existing Web + backend only                                                        |
| `pnpm dev:mobile`                                              | Build shared, start Expo Go Metro                                                  |
| `pnpm dev:mobile:android`                                      | Build shared, open Android Expo Go                                                 |
| `pnpm dev:mobile:ios`                                          | Build shared, open iOS simulator; macOS only                                       |
| `pnpm --filter @kanban/mobile typecheck`                       | Check native routes, config and shared type fixture; build shared first            |
| `pnpm test:mobile`                                             | Build shared, run real Metro shared-import smoke tests                             |
| `pnpm bundle:mobile`                                           | Build shared, export Android production JS/Hermes bundle to ignored `dist/android` |
| `pnpm --filter @kanban/mobile bundle:development`              | Export Android development JS to ignored `dist/development`; build shared first    |
| `pnpm --filter @kanban/mobile bundle:ios`                      | Export iOS JS/Hermes bundle; does not compile/sign an iOS app                      |
| `pnpm lint` / `pnpm test` / `pnpm build` / `pnpm format:check` | Existing root checks; mobile test/type checking included                           |

`pnpm -r build` topologically builds `@kanban/shared`, then mobile's `build` runs
**type checking and an Android JS bundle**. Gradle/Xcode/EAS never run implicitly in
root builds. `pnpm -r test` includes Node/Metro smoke and Jest component tests. CI also exports an Android JS bundle; no signing secrets or native SDK are required by the quality job. See [testing and local APK builds](testing.md). Existing Dockerfiles explicitly
copy/build only backend/frontend/shared and use filtered installs.

Run builds that rewrite `packages/shared/dist` **before**, not concurrently with,
Metro exports or tests that read that directory. On machines where frontend
Vitest workers contend for resources, limit workers for the current shell:

```powershell
$env:VITEST_MAX_WORKERS = '2'
pnpm test
Remove-Item Env:VITEST_MAX_WORKERS
```

This uses Vitest's environment override; it does not change repository test
timeouts, assertions or CI configuration. Native bundle scripts also audit their
source maps for the compiled shared ESM module and unwanted Web/server/Node shim
dependencies, and verify the exported asset bytes contain the approved logo.

Prettier expects LF line endings. A Windows checkout with `core.autocrlf=true`
can make the default `pnpm format:check` report otherwise formatted existing
files. `pnpm format:check --end-of-line auto` checks formatting while accepting
the checkout's line endings. CI's normal LF checkout continues using the original
command; do not mass-format unrelated files to fix a local line-ending mismatch.

## Shared contracts and Metro

`@kanban/shared` retains its existing `types`, `import` (ESM) and `require` (CJS)
exports. There is no `react-native` condition, source alias or hoisted linker.
`metro.config.cjs` uses only Expo's `getDefaultConfig`; Expo discovers the pnpm
workspace and symlinks automatically. Build shared before starting Metro. When
editing shared source, rebuild it to update its `dist` exports.

The root layout calls `verifySharedCompatibility()` once. That imports the real
`BoardRole.MEMBER` runtime value and its shared type, checks the export and returns
it. It does **not** select a user's role or render fake business data. A test fixture
also consumes `ApiSuccessResponse<BoardRole>` and evaluates the emitted Metro code.

If Metro has stale module paths after dependencies/config change:

```powershell
pnpm --filter @kanban/shared build
pnpm --filter @kanban/mobile dev --clear
```

## Device acceptance still required

JavaScript bundle success is not Android boot or physical-device proof. On an
emulator and a physical Android phone, record device/OS/Expo Go versions and:

- Force-stop/reopen the app and confirm the original logo and bootstrap text.
- Edit bootstrap text, save and observe Fast Refresh; restore the text afterward.
- Check small phone and large font settings, safe areas, landscape and TalkBack.
- Capture a real screenshot under
  `docs/design/screens/implementation/mob-01-expo-foundation/` and link it in the
  task record. Do not use a generated mockup or bundle as screenshot evidence.

Windows cannot compile/run an iOS simulator. Use a Mac with compatible Xcode for
`ios:native` / the simulator, or a separately authorized cloud workflow later.
Development package/bundle IDs `tech.kanvexa.mobile.dev` and scheme `kanvexa-dev`
are local development identifiers. Release IDs, universal/app links, native icon
exports (including opaque iOS/adaptive Android variants), and signing need their later release issue decisions. The in-app PNG is a byte-identical copy
of the supplied transparent logo; it is not redrawn or recolored.
