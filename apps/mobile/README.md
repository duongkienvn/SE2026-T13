# Kanvexa Mobile

MOB-01 adds an Expo native application with one branded bootstrap screen. Follow
the [Windows/Android development guide](../../docs/mobile/development.md) for setup,
the pinned dependency matrix, commands and outstanding device checks.

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm dev:mobile
# Or launch an already running Android emulator / attached Android device:
pnpm dev:mobile:android
```

The root wrappers build `@kanban/shared` before starting Metro. For direct commands
in this package, first run `pnpm --filter @kanban/shared build` at the root.

`pnpm build` checks mobile TypeScript and exports an Android JS bundle; native builds are explicit opt-in commands.
MOB-05 adds the SecureStore-backed session owner (`src/infrastructure/auth/`);
its contract for navigation, REST/Query and realtime is in the
[session guide](../../docs/mobile/session.md). The REST/Query
foundation now shares one transport with the session owner; see the
[network guide](../../docs/mobile/network.md). MOB-06 adds session-scoped native
Socket.IO, authorized Board subscriptions, transient presence and Query
reconciliation; future screens integrate through the
[realtime guide](../../docs/mobile/realtime.md).
MOB-03 supplies the navigation shell, MOB-08 adds email/password authentication
and recovery, and MOB-10 adds the Home dashboard. Additional feature screens and
release signing remain in their respective issues.

See the [testing and local APK guide](../../docs/mobile/testing.md) for harness,
CI and Android validation instructions.
