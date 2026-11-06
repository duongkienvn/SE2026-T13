export const navigationKeys: Readonly<Record<string, string>> = {
  h: '/home',
  t: '/my-tasks',
  b: '/boards',
};
export const boardViewKeys: Readonly<Record<string, string>> = {
  '1': '',
  '2': '/calendar',
  '3': '/table',
};
export const chordTimeoutMs = 1000;

export const shortcutGroups = [
  {
    title: 'Navigation',
    rows: [
      {
        label: 'Go to Home',
        keys: ['G', 'H'],
        scope: 'Anywhere outside an overlay',
      },
      {
        label: 'Go to My Tasks',
        keys: ['G', 'T'],
        scope: 'Anywhere outside an overlay',
      },
      {
        label: 'Go to Boards',
        keys: ['G', 'B'],
        scope: 'Anywhere outside an overlay',
      },
    ],
  },
  {
    title: 'Board & Cards',
    rows: [
      { label: 'Open Board view', keys: ['1'], scope: 'On a Board' },
      { label: 'Open Calendar view', keys: ['2'], scope: 'On a Board' },
      { label: 'Open Table view', keys: ['3'], scope: 'On a Board' },
      {
        label: 'Focus next / previous card',
        keys: ['J', '/', 'K'],
        scope: 'Visible Board cards',
      },
      {
        label: 'Open focused card',
        keys: ['Enter'],
        scope: 'Focused Board card',
      },
    ],
  },
  {
    title: 'General',
    rows: [
      {
        label: 'Open global search',
        keys: ['Mod', 'K'],
        scope: 'Outside a dialog',
      },
      {
        label: 'Open keyboard shortcuts',
        keys: ['?'],
        scope: 'Outside an overlay',
      },
      {
        label: 'Close the current dialog',
        keys: ['Esc'],
        scope: 'Active dialog or inspector',
      },
    ],
  },
] as const;

export function modifierLabel(platform: string): string {
  return /Mac|iPhone|iPad/i.test(platform) ? '⌘' : 'Ctrl';
}
