import { useEffect, useRef } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useAuth } from '../auth/useAuth';
import { useAuthSession } from '../auth/auth-session-context';
import { usePreferences } from './hooks';
import {
  applyTheme,
  clearCachedTheme,
  DARK_QUERY,
  readCachedTheme,
  resolveTheme,
  writeCachedTheme,
} from './theme';
import type { ThemePreference } from './types';

/**
 * Applies the signed-in user's theme to `<html data-theme>`. Signed out, pages
 * follow the OS; no account's choice is shown before that account is known.
 */
export function ThemeSync() {
  const { status, user } = useAuth();
  const { generation } = useAuthSession();
  const { data } = usePreferences();
  const systemDark = useMediaQuery(DARK_QUERY);
  const userId = user?.id ?? null;
  const saved = data?.theme;

  // null while the session is still being confirmed: keep the boot script's choice.
  let preference: ThemePreference | null = null;
  if (status === 'anonymous') preference = 'system';
  else if (userId) preference = saved ?? readCachedTheme(userId) ?? 'system';

  useEffect(() => {
    if (preference) applyTheme(resolveTheme(preference, systemDark));
    // Preserve first-paint boot only on initial load. A different unverified
    // session must not keep displaying the previous account's theme.
    else if (generation > 0) applyTheme(resolveTheme('system', systemDark));
  }, [preference, systemDark, generation]);

  useEffect(() => {
    if (userId && saved) writeCachedTheme(userId, saved);
  }, [userId, saved]);

  // Forget the cached choice on logout or expiry, so the next person on this
  // device does not start in it.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (status === 'authenticated') wasSignedIn.current = true;
    else if (status === 'anonymous' && wasSignedIn.current) {
      wasSignedIn.current = false;
      clearCachedTheme();
    }
  }, [status]);

  return null;
}
