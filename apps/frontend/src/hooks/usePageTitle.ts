import { useEffect } from 'react';

const TITLE_SUFFIX = 'Kanban';

/** Sets the browser tab title, e.g. "Log in · Kanban". Screen readers announce it on navigation. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${TITLE_SUFFIX}`;
  }, [title]);
}
