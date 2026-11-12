import { parsePath } from './routes.ts';

/** Preview APKs expose only data-free shell routes until MOB-05 is integrated. */
export function isPublicNavigationPreview(path: string): boolean {
  if (process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW !== '1') return false;
  const destination = parsePath(path);
  return destination?.kind === 'tab' || destination?.kind === 'screen';
}
