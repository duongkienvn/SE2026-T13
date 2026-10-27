import { useId } from 'react';
import { Link } from 'react-router';
import { BrandLogo } from '../../components/Brand';
import { ChevronRightIcon } from '../../components/icons';
import type { NavGroup, NavItem } from './navigation';
import { useSidebarPreference } from './useSidebarPreference';

interface SidebarProps {
  groups: NavGroup[];
  activeItemId?: string;
}

export function Sidebar({ groups, activeItemId }: SidebarProps) {
  const { expanded, desktop, toggle } = useSidebarPreference();
  const itemsId = useId();
  return (
    <nav
      aria-label="Primary"
      className={`flex shrink-0 flex-col border-r border-line bg-surface ${expanded ? 'w-56' : 'w-14 md:w-15'}`}
    >
      <div className="flex h-14 shrink-0 items-center justify-center md:h-15">
        <BrandLogo className="size-12" />
        {expanded && (
          <span className="text-xl font-semibold tracking-tight text-ink">
            Kanvexa
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        title={
          !desktop
            ? 'Sidebar stays compact on narrow screens'
            : expanded
              ? 'Collapse sidebar'
              : 'Expand sidebar'
        }
        aria-expanded={expanded}
        aria-controls={itemsId}
        disabled={!desktop}
        onClick={toggle}
        className="mx-1 my-2 flex min-h-10 shrink-0 items-center justify-center gap-3 rounded-lg text-sm text-muted enabled:hover:bg-app enabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
      >
        <ChevronRightIcon
          className={`size-5 shrink-0 ${expanded ? 'rotate-180' : ''}`}
        />
        {expanded && <span>Collapse sidebar</span>}
      </button>
      <div
        id={itemsId}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {groups.map((group) => (
          <SidebarGroup
            key={group.id}
            group={group}
            activeItemId={activeItemId}
            expanded={expanded}
          />
        ))}
      </div>
    </nav>
  );
}

interface SidebarGroupProps {
  group: NavGroup;
  activeItemId?: string;
  expanded: boolean;
}

function SidebarGroup({ group, activeItemId, expanded }: SidebarGroupProps) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col">
      <h2
        id={headingId}
        className={
          expanded
            ? 'px-5 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase'
            : 'sr-only'
        }
      >
        {group.label}
      </h2>
      {expanded && group.emptyText && (
        <p className="px-5 py-1 text-xs text-muted">{group.emptyText}</p>
      )}
      <ul className="flex flex-col">
        {group.items.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            active={item.id === activeItemId}
            expanded={expanded}
          />
        ))}
      </ul>
    </div>
  );
}

interface SidebarItemProps {
  item: NavItem;
  active: boolean;
  expanded: boolean;
}

function SidebarItem({ item, active, expanded }: SidebarItemProps) {
  const { icon: Icon, label } = item;
  const layout = `flex min-h-12 w-full items-center gap-3 py-3 ${expanded ? 'px-5 text-left' : 'justify-center'}`;

  if (item.availability === 'soon') {
    // Not focusable: an unfinished feature must not be a keyboard dead end.
    return (
      <li
        title={`${label} — coming soon`}
        className={`${layout} cursor-default text-muted/70`}
      >
        <Icon className="size-5 shrink-0" />
        {expanded ? (
          <>
            <span className="text-sm font-medium">{label}</span>
            <span className="ml-auto rounded-full bg-app px-2 py-0.5 text-[11px] font-medium text-muted">
              Soon
            </span>
            <span className="sr-only">, coming soon</span>
          </>
        ) : (
          <span className="sr-only">{label}, coming soon</span>
        )}
      </li>
    );
  }

  return (
    <li>
      <Link
        to={item.path}
        aria-label={expanded ? undefined : label}
        aria-current={active ? 'page' : undefined}
        title={expanded ? undefined : label}
        className={`${layout} transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
          active
            ? 'bg-primary-soft text-primary shadow-[inset_-3px_0_0_var(--color-primary)]'
            : 'text-muted hover:bg-app hover:text-ink'
        }`}
      >
        <Icon className="size-5 shrink-0" />
        {expanded && <span className="text-sm font-medium">{label}</span>}
      </Link>
    </li>
  );
}
