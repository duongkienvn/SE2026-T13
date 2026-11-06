import { Link, useLocation } from 'react-router';

export function BoardViews({
  boardId,
  active,
}: {
  boardId: string;
  active: 'board' | 'calendar' | 'table';
}) {
  const { search } = useLocation();
  return (
    <nav aria-label="Board views" className="flex items-center gap-2 text-sm">
      {(['board', 'calendar', 'table'] as const).map((view) => (
        <Link
          key={view}
          aria-current={active === view ? 'page' : undefined}
          className={`rounded-lg px-3 py-2 font-medium ${active === view ? 'bg-primary text-white' : 'text-ink hover:bg-app'}`}
          to={`/boards/${encodeURIComponent(boardId)}${view === 'board' ? '' : `/${view}`}${search}`}
        >
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
