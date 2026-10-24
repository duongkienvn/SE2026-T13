import { useEffect } from 'react';

const TITLE_SUFFIX = 'Kanvexa';

/** Sets the browser tab title, e.g. "Log in · Kanvexa". Screen readers announce it on navigation. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${TITLE_SUFFIX}`;
  }, [title]);
}
