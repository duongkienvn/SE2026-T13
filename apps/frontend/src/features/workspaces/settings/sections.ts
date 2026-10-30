import {
  AlertIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  type IconProps,
} from '../../../components/icons';
import { workspacePath } from '../navigation';

export interface WorkspaceSettingsSection {
  id: 'general' | 'members' | 'permissions' | 'danger';
  label: string;
  summary: string;
  icon: (props: IconProps) => React.JSX.Element;
  danger?: boolean;
}

/** Order and names follow the approved Settings rail (ux-spec §5). */
export const workspaceSettingsSections: WorkspaceSettingsSection[] = [
  {
    id: 'general',
    label: 'General',
    summary: 'Name, description and icon',
    icon: SettingsIcon,
  },
  {
    id: 'members',
    label: 'Members & Invitations',
    summary: 'Who is in this workspace',
    icon: UsersIcon,
  },
  {
    id: 'permissions',
    label: 'Permissions',
    summary: 'What Board owners and members may do',
    icon: ShieldCheckIcon,
  },
  {
    id: 'danger',
    label: 'Danger Zone',
    summary: 'Leave or delete this workspace',
    icon: AlertIcon,
    danger: true,
  },
];

export const workspaceSettingsPath = (
  workspaceId: string,
  section?: WorkspaceSettingsSection['id'],
) => `${workspacePath(workspaceId)}/settings${section ? `/${section}` : ''}`;
