import type { SecureKeyValueStore } from '../../infrastructure/auth/credential-store.ts';
import { uuid4 } from './contracts.ts';
const installKey = 'kanvexa.push.installation.v1',
  pendingKey = 'kanvexa.push.cleanup.v1';
export function createPushStorage(
  store: SecureKeyValueStore,
  randomUUID: () => string,
) {
  let pendingInstall: Promise<string> | undefined;
  return {
    installation() {
      return (pendingInstall ??= (async () => {
        const existing = await store.getItemAsync(installKey);
        if (uuid4(existing)) return existing;
        const id = randomUUID();
        if (!uuid4(id)) throw new Error('Installation setup unavailable');
        await store.setItemAsync(installKey, id);
        if ((await store.getItemAsync(installKey)) !== id)
          throw new Error('Installation setup unavailable');
        return id;
      })().catch((error) => {
        pendingInstall = undefined;
        throw error;
      }));
    },
    async markCleanup(userId: string, installationId: string) {
      // Routing IDs only. Never persist an access token or Expo routing token.
      await store.setItemAsync(
        pendingKey,
        JSON.stringify({ userId, installationId }),
      );
    },
    async pending() {
      const raw = await store.getItemAsync(pendingKey);
      try {
        const v = JSON.parse(raw ?? 'null') as {
          userId?: unknown;
          installationId?: unknown;
        } | null;
        return v && uuid4(v.userId) && uuid4(v.installationId)
          ? { userId: v.userId, installationId: v.installationId }
          : null;
      } catch {
        return null;
      }
    },
    clearCleanup: () => store.deleteItemAsync(pendingKey),
  };
}
export type PushStorage = ReturnType<typeof createPushStorage>;
