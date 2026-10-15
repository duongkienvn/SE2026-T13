import type { ComponentType } from 'react';
import {
  FolderIcon,
  SettingsIcon,
  UsersIcon,
  type IconProps,
} from '../../components/icons';

export interface NavItem {
  id: string;
  label: string;
  icon: ComponentType<IconProps>;
  /** In-app route the item opens; items without one have no feature yet. */
  path?: string;
  /** Route inside the current board; the item is unavailable outside a board. */
  boardPath?: (boardId: string) => string;
  /** Items without a handler are rendered as unavailable until their feature exists. */
  onSelect?: () => void;
}

export const primaryNavItems: NavItem[] = [
  { id: 'boards', label: 'Boards', icon: FolderIcon, path: '/boards' },
  {
    id: 'members',
    label: 'Board members',
    icon: UsersIcon,
    boardPath: (boardId) => `/boards/${boardId}/members`,
  },
];

export const secondaryNavItems: NavItem[] = [
  {
    id: 'settings',
    label: 'Profile settings',
    icon: SettingsIcon,
    path: '/profile',
  },
];
