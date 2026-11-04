import type { HomeDashboard } from '@kanban/shared';
import { Link } from 'react-router';
import {
  AlertIcon,
  CheckSquareIcon,
  ClockIcon,
  LayersIcon,
  type IconProps,
} from '../../../components/icons';

interface Tile {
  id: keyof HomeDashboard['summary'];
  label: (count: number) => string;
  Icon: (props: IconProps) => React.JSX.Element;
  to: string;
}

/** Each tile opens the real page that lists what it counts. */
const tiles: Tile[] = [
  {
    id: 'assignedActiveCount',
    label: (count) => (count === 1 ? 'My Card' : 'My Cards'),
    Icon: CheckSquareIcon,
    to: '/my-tasks',
  },
  {
    id: 'dueNext7DaysCount',
    label: () => 'Due Soon',
    Icon: ClockIcon,
    to: '/my-tasks?group=NEXT_7_DAYS',
  },
  {
    id: 'overdueCount',
    label: () => 'Overdue',
    Icon: AlertIcon,
    to: '/my-tasks?group=OVERDUE',
  },
  {
    id: 'workspaceCount',
    label: (count) => (count === 1 ? 'Workspace' : 'Workspaces'),
    Icon: LayersIcon,
    to: '/workspaces',
  },
];

const descriptions: Record<Tile['id'], string> = {
  assignedActiveCount: 'assigned active cards',
  dueNext7DaysCount: 'cards due in the next 7 days',
  overdueCount: 'overdue cards',
  workspaceCount: 'workspaces',
};

export function SummaryTiles({
  summary,
}: {
  summary: HomeDashboard['summary'];
}) {
  return (
    <section aria-label="Summary" className="home-tiles">
      {tiles.map(({ id, label, Icon, to }) => (
        <Link
          key={id}
          to={to}
          className="home-tile"
          data-tone={id}
          aria-label={`${summary[id]} ${descriptions[id]}`}
        >
          <span className="home-tile-icon" aria-hidden="true">
            <Icon />
          </span>
          <span className="min-w-0">
            <span className="home-tile-count">{summary[id]}</span>
            <span className="home-tile-label">{label(summary[id])}</span>
          </span>
        </Link>
      ))}
    </section>
  );
}
