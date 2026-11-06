import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';

export function BoardNavigation({
  boardId,
  active,
  canReadMembers,
  onActivity,
}: {
  boardId: string;
  active: 'kanban' | 'calendar' | 'table' | 'members' | 'settings';
  canReadMembers: boolean;
  onActivity: () => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const { search } = useLocation();
  useEffect(() => {
    // Keep the current destination visible after a route change on phones.
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [active]);
  const tabClass =
    'inline-flex min-h-10 shrink-0 items-center border-b-2 px-1 text-sm font-medium whitespace-nowrap hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary';
  const destination = ['kanban', 'calendar', 'table'].includes(active)
    ? 'kanban'
    : active;
  const link = (id: typeof active, label: string, suffix = '') => (
    <Link
      to={`/boards/${encodeURIComponent(boardId)}${suffix}${search}`}
      aria-current={destination === id ? 'page' : undefined}
      className={`${tabClass} ${destination === id ? 'border-primary-solid text-primary' : 'border-transparent text-muted'}`}
    >
      {label}
    </Link>
  );
  return (
    <nav
      ref={nav}
      onFocus={(event) =>
        event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }
      aria-label="Board navigation"
      className="mt-2 flex shrink-0 gap-4 overflow-x-auto overscroll-x-contain border-b border-line [scrollbar-width:thin]"
    >
      {link('kanban', 'Kanban')}
      {canReadMembers && link('members', 'Members', '/members')}
      <button
        type="button"
        className={`${tabClass} border-transparent text-muted`}
        onClick={onActivity}
      >
        Activity
      </button>
      {link('settings', 'Board settings', '/settings')}
    </nav>
  );
}
