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

`pnpm build` checks mobile TypeScript; native bundles are explicit opt-in commands.
MOB-05 adds the SecureStore-backed session owner (`src/infrastructure/auth/`);
its contract for navigation, REST/Query and realtime is in the
[session guide](../../docs/mobile/session.md). The REST/Query
foundation now shares one transport with the session owner; see the
[network and MOB-06 integration guide](../../docs/mobile/network.md).
MOB-03 supplies the navigation shell. Feature screens, auth forms, realtime and
release signing remain in their respective issues.
