import type { ComponentType } from 'react';
import {
  BellIcon,
  LinkIcon,
  LockIcon,
  PaletteIcon,
  ShieldCheckIcon,
  SlidersIcon,
  UserIcon,
  type IconProps,
} from '../../components/icons';

interface SettingsSectionBase {
  /** Stable identifier used for keys, active state and tests. */
  id: string;
  label: string;
  /** One line under the label in the mobile section list. */
  summary: string;
  icon: ComponentType<IconProps>;
}

/** A working section with its own route under `/settings`. */
export interface AvailableSettingsSection extends SettingsSectionBase {
  availability: 'available';
  /** Relative to `/settings`. */
  path: string;
}

/**
 * An approved section whose feature has not shipped. It is shown disabled
 * with a "Soon" status and has no route, page, controls or requests.
 */
export interface SoonSettingsSection extends SettingsSectionBase {
  availability: 'soon';
}

export type SettingsSection = AvailableSettingsSection | SoonSettingsSection;

/**
 * Approved Account Settings order (#92). To activate a future section, build
 * its real page and authorization first, then give it a path here.
 */
export const settingsSections: SettingsSection[] = [
  {
    id: 'profile',
    label: 'Profile',
    summary: 'Display name, avatar and email',
    icon: UserIcon,
    availability: 'available',
    path: 'profile',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    summary: 'Light, dark or match system',
    icon: PaletteIcon,
    availability: 'available',
    path: 'appearance',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    summary: 'In-app and email notifications',
    icon: BellIcon,
    availability: 'soon',
  },
  {
    id: 'preferences',
    label: 'Preferences',
    summary: 'Time zone, date format and week start',
    icon: SlidersIcon,
    availability: 'available',
    path: 'preferences',
  },
  {
    id: 'security',
    label: 'Security',
    summary: 'Password and account recovery',
    icon: ShieldCheckIcon,
    availability: 'available',
    path: 'security',
  },
  {
    id: 'connected-accounts',
    label: 'Connected Accounts',
    summary: 'Google sign-in',
    icon: LinkIcon,
    availability: 'available',
    path: 'connected-accounts',
  },
  {
    id: 'data-privacy',
    label: 'Data & Privacy',
    summary: 'Data export and account controls',
    icon: LockIcon,
    availability: 'soon',
  },
];

export const settingsPath = (section: AvailableSettingsSection) =>
  `/settings/${section.path}`;
