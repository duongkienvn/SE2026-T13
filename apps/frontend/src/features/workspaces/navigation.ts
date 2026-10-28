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

/** Keep the current delivered section when switching workspaces. */
export function workspaceDestination(workspaceId: string, pathname: string) {
  return `${workspacePath(workspaceId)}${/\/workspaces\/[^/]+\/boards\/?$/.test(pathname) ? '/boards' : ''}`;
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
    {
      id: 'boards',
      label: 'Boards',
      icon: ColumnsIcon,
      availability: 'available',
      path: `${workspacePath(workspaceId)}/boards`,
    },
    { id: 'members', label: 'Members', icon: UsersIcon, availability: 'soon' },
    {
      id: 'settings',
      label: 'Settings',
      icon: SettingsIcon,
      availability: 'soon',
    },
  ];
}
