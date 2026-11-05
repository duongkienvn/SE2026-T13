import type { NotificationKind } from '@kanban/shared';
import {
  CalendarIcon,
  ColumnsIcon,
  LockIcon,
  MailIcon,
  UserIcon,
  UsersIcon,
  type IconProps,
} from '../../components/icons';

function AtIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.4 6.9" />
    </svg>
  );
}

export interface KindMeta {
  label: string;
  Icon: (props: IconProps) => React.JSX.Element;
  tone: 'blue' | 'violet' | 'red' | 'teal' | 'green' | 'indigo';
}

/** Six known kinds; anything else is rejected by the API layer. */
export const kindMeta: Record<NotificationKind, KindMeta> = {
  CARD_ASSIGNED: { label: 'Assigned to a card', Icon: UserIcon, tone: 'blue' },
  COMMENT_MENTIONED: {
    label: 'You were mentioned',
    Icon: AtIcon,
    tone: 'violet',
  },
  WORKSPACE_INVITED: {
    label: 'Workspace invitation',
    Icon: MailIcon,
    tone: 'indigo',
  },
  BOARD_INVITED: {
    label: 'Board invitation',
    Icon: ColumnsIcon,
    tone: 'teal',
  },
  MEMBERSHIP_CHANGED: {
    label: 'Membership changed',
    Icon: UsersIcon,
    tone: 'green',
  },
  DUE_REMINDER: {
    label: 'Deadline approaching',
    Icon: CalendarIcon,
    tone: 'red',
  },
};

export const unavailableMeta: KindMeta = {
  label: 'No longer available',
  Icon: LockIcon,
  tone: 'blue',
};
