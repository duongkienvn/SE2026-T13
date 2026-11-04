import { describe, expect, it } from 'vitest';
import { FolderIcon } from '../../components/icons';
import { findActiveNavItemId, navGroups, type NavGroup } from './navigation';

describe('navGroups', () => {
  it('matches the approved App Shell V2 inventory', () => {
    expect(
      navGroups.map((group) => ({
        id: group.id,
        items: group.items.map((item) => `${item.id}:${item.availability}`),
      })),
    ).toEqual([
      {
        id: 'personal',
        items: [
          'home:soon',
          'my-tasks:available',
          'boards:available',
          'starred:available',
        ],
      },
      { id: 'workspaces', items: ['create-workspace:soon'] },
    ]);
  });

  it('gives a route only to available items and never shows upsell entries', () => {
    for (const item of navGroups.flatMap((group) => group.items)) {
      expect('path' in item).toBe(item.availability === 'available');
      expect(item.label).not.toMatch(/pro|upgrade|plan|pricing|billing/i);
    }
  });
});

describe('findActiveNavItemId', () => {
  it.each([
    ['/boards', 'boards'],
    ['/my-tasks', 'my-tasks'],
    ['/boards/1', 'boards'],
    ['/boards/1/members', 'boards'],
    ['/boards/1/cards/2', 'boards'],
    ['/profile', undefined],
    ['/boardsx', undefined],
  ])('maps %s to %s', (pathname, expected) => {
    expect(findActiveNavItemId(navGroups, pathname)).toBe(expected);
  });

  it('prefers the most specific path and ignores coming-soon items', () => {
    const groups: NavGroup[] = [
      {
        id: 'g',
        label: 'G',
        items: [
          {
            id: 'all',
            label: 'All',
            icon: FolderIcon,
            availability: 'available',
            path: '/boards',
          },
          {
            id: 'archive',
            label: 'Archive',
            icon: FolderIcon,
            availability: 'available',
            path: '/boards/archive',
          },
          { id: 'soon', label: 'Soon', icon: FolderIcon, availability: 'soon' },
        ],
      },
    ];
    expect(findActiveNavItemId(groups, '/boards/archive/1')).toBe('archive');
    expect(findActiveNavItemId(groups, '/boards/2')).toBe('all');
  });
});

it('selects only Starred for its directory URL and Boards for other board URLs', () => {
  expect(findActiveNavItemId(navGroups, '/boards', '?view=starred')).toBe(
    'starred',
  );
  expect(findActiveNavItemId(navGroups, '/boards', '?view=recent')).toBe(
    'boards',
  );
  expect(findActiveNavItemId(navGroups, '/boards/one', '?view=starred')).toBe(
    'boards',
  );
});
