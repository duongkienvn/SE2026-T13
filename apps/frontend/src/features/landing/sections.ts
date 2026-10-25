/** The three in-page anchors of the landing page; each id appears once in the DOM. */
export const LANDING_SECTIONS = [
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'why-kanvexa', label: 'Why Kanvexa' },
] as const;

/** Matches `<title>` in index.html so client navigation back to `/` restores it. */
export const LANDING_TITLE = 'Kanvexa · Collaborative Kanban boards';
