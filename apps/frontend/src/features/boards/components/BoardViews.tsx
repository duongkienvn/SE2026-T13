import { Link, useLocation } from 'react-router';
import {
  CalendarIcon,
  ColumnsIcon,
  TableIcon,
} from '../../../components/icons';
import './board-views.css';

export function BoardViews({
  boardId,
  active,
}: {
  boardId: string;
  active: 'board' | 'calendar' | 'table';
}) {
  const { search } = useLocation();
  return (
    <nav aria-label="Board views" className="board-views">
      {(['board', 'calendar', 'table'] as const).map((view) => (
        <Link
          key={view}
          aria-current={active === view ? 'page' : undefined}
          className="board-view-button"
          to={`/boards/${encodeURIComponent(boardId)}${view === 'board' ? '' : `/${view}`}${search}`}
        >
          {view === 'board' ? (
            <ColumnsIcon />
          ) : view === 'calendar' ? (
            <CalendarIcon />
          ) : (
            <TableIcon />
          )}
          {view === 'board'
            ? 'Board'
            : view === 'calendar'
              ? 'Calendar'
              : 'Table'}
        </Link>
      ))}
    </nav>
  );
}
