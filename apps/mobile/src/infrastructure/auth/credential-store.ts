import {
  decodeCredential,
  encodeCredential,
  type StoredCredential,
} from './credential-record.ts';

/** The subset of `expo-secure-store` the session needs; injectable in tests. */
export interface SecureKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const CREDENTIAL_KEY = 'kanvexa.session.v1';

export type CredentialReadResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'valid'; readonly credential: StoredCredential }
  /** Corrupted or foreign value; it has already been removed if possible. */
  | { readonly kind: 'invalid' }
  /** Keychain/Keystore refused the read (locked, rejected or broken entry). */
  | { readonly kind: 'error' };

export interface CredentialStore {
  read(): Promise<CredentialReadResult>;
  /** Resolves `true` only when the exact record reads back afterwards. */
  write(credential: StoredCredential): Promise<boolean>;
  /** Best-effort removal; resolves `false` when the platform refused it. */
  clear(): Promise<boolean>;
}

/**
 * Wraps the platform store so callers never see an exception, a partial write
 * or a record that failed validation. Values and errors are never logged.
 */
export function createCredentialStore(
  storage: SecureKeyValueStore,
): CredentialStore {
  async function clear(): Promise<boolean> {
    try {
      await storage.deleteItemAsync(CREDENTIAL_KEY);
      return true;
    } catch {
      return false;
    }
  }

  return {
    async read() {
      let raw: string | null;
      try {
        raw = await storage.getItemAsync(CREDENTIAL_KEY);
      } catch {
        // An unreadable entry (e.g. Android key invalidated) blocks every
        // future read; removing it lets the next sign-in start clean.
        await clear();
        return { kind: 'error' };
      }
      if (raw === null) return { kind: 'none' };
      const credential = decodeCredential(raw);
      if (credential === null) {
        await clear();
        return { kind: 'invalid' };
      }
      return { kind: 'valid', credential };
    },

    async write(credential) {
      const value = encodeCredential(credential);
      try {
        await storage.setItemAsync(CREDENTIAL_KEY, value);
        if ((await storage.getItemAsync(CREDENTIAL_KEY)) === value) return true;
      } catch {
        // Fall through: a failed or partial write must not survive.
      }
      await clear();
      return false;
    },

    clear,
  };
}
