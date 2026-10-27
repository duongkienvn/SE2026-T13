import { useId } from 'react';
import { Link } from 'react-router';
import { BrandLogo } from '../../components/Brand';
import { ChevronRightIcon, LayersIcon } from '../../components/icons';
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
      className={`flex shrink-0 flex-col border-r border-line bg-surface ${expanded ? 'w-64' : 'w-16'}`}
    >
      <div
        className={`flex h-14 shrink-0 items-center gap-2 md:h-15 ${expanded ? 'px-4' : 'justify-center'}`}
      >
        <BrandLogo className="size-9" />
        {expanded && (
          <span className="text-lg font-semibold tracking-tight text-ink">
            Kanvexa
          </span>
        )}
      </div>
      <div
        id={itemsId}
        className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-2 ${expanded ? 'px-3' : 'px-2'}`}
      >
        <WorkspaceSwitcherSlot expanded={expanded} />
        {groups.map((group) => (
          <SidebarGroup
            key={group.id}
            group={group}
            activeItemId={activeItemId}
            expanded={expanded}
          />
        ))}
      </div>
      <div
        className={`shrink-0 border-t border-line py-2 ${expanded ? 'px-3' : 'px-2'}`}
      >
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
          className={`flex min-h-10 w-full items-center gap-3 rounded-lg text-sm text-muted enabled:hover:bg-app enabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${expanded ? 'px-3' : 'justify-center'}`}
        >
          <ChevronRightIcon
            className={`size-5 shrink-0 ${expanded ? 'rotate-180' : ''}`}
          />
          {expanded && <span>Collapse sidebar</span>}
        </button>
      </div>
    </nav>
  );
}

/**
 * Approved position of the Workspace switcher. Until Workspaces ship it is a
 * static status card: no invented Workspace name, menu or plan badge.
 */
function WorkspaceSwitcherSlot({ expanded }: { expanded: boolean }) {
  const icon = (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-app text-muted">
      <LayersIcon className="size-4.5" />
    </span>
  );
  if (!expanded) {
    return (
      <div
        title="Workspace switcher — coming soon"
        className="mb-1 flex justify-center py-1"
      >
        {icon}
        <span className="sr-only">Workspace switcher, coming soon</span>
      </div>
    );
  }
  return (
    <div
      title="Workspace switcher — coming soon"
      className="mb-1 flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          Workspace
        </span>
        <span className="block truncate text-xs text-muted">Coming soon</span>
      </span>
    </div>
  );
}

function SoonBadge() {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full bg-app px-1.5 py-0.5 text-[11px] font-medium text-muted"
    >
      Soon
    </span>
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
    <div
      role="group"
      aria-labelledby={headingId}
      className={`flex flex-col ${expanded ? '' : 'mt-1 border-t border-line pt-2'}`}
    >
      <h2
        id={headingId}
        className={
          expanded
            ? 'px-3 pt-4 pb-1.5 text-xs font-semibold tracking-wide text-muted uppercase'
            : 'sr-only'
        }
      >
        {group.label}
      </h2>
      {expanded && group.emptyText && (
        <p className="px-3 pb-1 text-xs text-muted">{group.emptyText}</p>
      )}
      <ul className="flex flex-col gap-0.5">
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
  const layout = `flex min-h-10 w-full items-center gap-2.5 rounded-lg ${expanded ? 'px-3 text-left' : 'justify-center'}`;

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
            <span className="min-w-0 truncate text-sm font-medium">
              {label}
            </span>
            <span className="ml-auto">
              <SoonBadge />
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
            ? 'bg-primary-soft font-semibold text-primary'
            : 'font-medium text-muted hover:bg-app hover:text-ink'
        }`}
      >
        <Icon className="size-5 shrink-0" />
        {expanded && <span className="min-w-0 truncate text-sm">{label}</span>}
      </Link>
    </li>
  );
}
