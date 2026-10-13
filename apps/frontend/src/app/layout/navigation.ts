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
  /** Items without a handler are rendered as unavailable until their feature exists. */
  onSelect?: () => void;
}

export const primaryNavItems: NavItem[] = [
  { id: 'boards', label: 'Boards', icon: FolderIcon },
  { id: 'members', label: 'Board members', icon: UsersIcon },
];

export const secondaryNavItems: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];
