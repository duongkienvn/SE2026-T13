import { Link, useLocation } from 'react-router';

/** Shared view selector; Table can join this navigation when implemented. */
export function BoardViews({
  boardId,
  active,
}: {
  boardId: string;
  active: 'board' | 'calendar';
}) {
  const { search } = useLocation();
  return (
    <nav aria-label="Board views" className="flex items-center gap-2 text-sm">
      {(['board', 'calendar'] as const).map((view) => (
        <Link
          key={view}
          aria-current={active === view ? 'page' : undefined}
          className={`rounded-lg px-3 py-2 font-medium ${active === view ? 'bg-primary text-white' : 'text-ink hover:bg-app'}`}
          to={`/boards/${encodeURIComponent(boardId)}${view === 'calendar' ? '/calendar' : ''}${search}`}
        >
          {view === 'board' ? 'Board' : 'Calendar'}
        </Link>
      ))}
    </nav>
  );
}
