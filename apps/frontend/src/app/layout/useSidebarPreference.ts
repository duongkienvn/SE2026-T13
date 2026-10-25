import { useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';

const STORAGE_KEY = 'kanvexa.sidebar.expanded';

/** Keep the desktop choice while narrow viewports use the compact rail. */
export function useSidebarPreference() {
  const desktop = useMediaQuery('(min-width: 1024px)', true);
  const [preferredExpanded, setPreferredExpanded] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    if (!desktop) return;
    const next = !preferredExpanded;
    setPreferredExpanded(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The in-memory choice still works when browser storage is blocked.
    }
  };
  return { expanded: desktop && preferredExpanded, desktop, toggle };
}
