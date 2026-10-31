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

/** Sidebar selects a Workspace; its horizontal tabs select the section. */
export function workspaceDestination(workspaceId: string) {
  return workspacePath(workspaceId);
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
    {
      id: 'members',
      label: 'Members',
      icon: UsersIcon,
      availability: 'available',
      path: `${workspacePath(workspaceId)}/members`,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: SettingsIcon,
      availability: 'available',
      path: `${workspacePath(workspaceId)}/settings`,
    },
  ];
}
