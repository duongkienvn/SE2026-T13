import {
  ColumnsIcon,
  HomeIcon,
  SettingsIcon,
  UsersIcon,
} from '../../components/icons';
import type { NavItem } from '../../app/layout/navigation';

export function workspacePath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}`;
}

/** Downstream owners activate a slot only when their real route exists. */
export function workspaceSections(workspaceId: string): NavItem[] {
  return [
    {
      id: 'overview',
      label: 'Overview',
      icon: HomeIcon,
      availability: 'available',
      path: workspacePath(workspaceId),
    },
    { id: 'boards', label: 'Boards', icon: ColumnsIcon, availability: 'soon' },
    { id: 'members', label: 'Members', icon: UsersIcon, availability: 'soon' },
    {
      id: 'settings',
      label: 'Settings',
      icon: SettingsIcon,
      availability: 'soon',
    },
  ];
}
