import type { ComponentType } from 'react';
import {
  CheckSquareIcon,
  ColumnsIcon,
  HomeIcon,
  PlusIcon,
  StarIcon,
  type IconProps,
} from '../../components/icons';

interface NavItemBase {
  /** Stable identifier used for active state, keys and tests. */
  id: string;
  label: string;
  icon: ComponentType<IconProps>;
}

/** A supported destination: rendered as a real link with route-aware active state. */
export interface AvailableNavItem extends NavItemBase {
  availability: 'available';
  path: string;
}

/**
 * An approved App Shell V2 slot whose feature has not shipped yet. It is
 * rendered muted with a "Soon" status and never navigates or calls an API.
 */
export interface SoonNavItem extends NavItemBase {
  availability: 'soon';
}

export type NavItem = AvailableNavItem | SoonNavItem;

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
  /** Shown inside the group when it has no destinations of its own yet. */
  emptyText?: string;
}

/**
 * Approved App Shell V2 navigation (#91). Activate a slot only after its real
 * page, API and authorization behavior exist: give it a path and mark it available.
 */
export const navGroups: NavGroup[] = [
  {
    id: 'personal',
    label: 'Personal',
    items: [
      { id: 'home', label: 'Home', icon: HomeIcon, availability: 'soon' },
      {
        id: 'my-tasks',
        label: 'My Tasks',
        icon: CheckSquareIcon,
        availability: 'soon',
      },
      {
        id: 'boards',
        label: 'Boards',
        icon: ColumnsIcon,
        availability: 'available',
        path: '/boards',
      },
      { id: 'starred', label: 'Starred', icon: StarIcon, availability: 'soon' },
    ],
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    // No Workspace rows exist until the Workspace workstream ships.
    emptyText: 'Workspaces are coming soon.',
    items: [
      {
        id: 'create-workspace',
        label: 'Create Workspace',
        icon: PlusIcon,
        availability: 'soon',
      },
    ],
  },
];

function matchesPath(path: string, pathname: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Most specific available item for the current route, e.g. Boards for `/boards/1/members`. */
export function findActiveNavItemId(
  groups: NavGroup[],
  pathname: string,
): string | undefined {
  return groups
    .flatMap((group) => group.items)
    .filter(
      (item): item is AvailableNavItem =>
        item.availability === 'available' && matchesPath(item.path, pathname),
    )
    .sort((a, b) => b.path.length - a.path.length)[0]?.id;
}
