import type { TaskGroup } from '@kanban/shared';
import {
  AlertIcon,
  CalendarIcon,
  ClockIcon,
  type IconProps,
} from '../../components/icons';

function UndatedIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="8.5" />
    </svg>
  );
}

export const taskGroups = [
  { id: 'OVERDUE', label: 'Overdue', Icon: AlertIcon },
  { id: 'NEXT_7_DAYS', label: 'Next 7 days', Icon: CalendarIcon },
  { id: 'LATER', label: 'Later', Icon: ClockIcon },
  { id: 'NO_DUE_DATE', label: 'No due date', Icon: UndatedIcon },
] satisfies {
  id: TaskGroup;
  label: string;
  Icon: (props: IconProps) => React.JSX.Element;
}[];
