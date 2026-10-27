import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandLogo } from '../../components/Brand';
import { LayersIcon, PanelLeftIcon } from '../../components/icons';
import type { NavGroup, NavItem } from './navigation';
import { SoonBadge } from './SoonBadge';
import { useSidebarPreference } from './useSidebarPreference';

interface SidebarProps {
  groups: NavGroup[];
  activeItemId?: string;
  footer?: (expanded: boolean) => ReactNode;
}

export function Sidebar({ groups, activeItemId, footer }: SidebarProps) {
  const { expanded, desktop, toggle } = useSidebarPreference();
  const itemsId = useId();
  const toggleButton = desktop && (
    <button
      type="button"
      aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      aria-expanded={expanded}
      aria-controls={itemsId}
      onClick={toggle}
      className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
    >
      <PanelLeftIcon className="size-5" />
    </button>
  );
  return (
    <nav
      aria-label="Primary"
      // Phones use the header menu drawer instead of a rail.
      className={`hidden shrink-0 flex-col border-r border-line bg-surface md:flex ${expanded ? 'w-64' : 'w-16'}`}
    >
      <div
        className={`flex shrink-0 items-center gap-2 ${expanded ? 'h-14 px-4 md:h-15' : desktop ? 'flex-col py-2' : 'h-14 justify-center md:h-15'}`}
      >
        <Link
          to="/"
          aria-label="Kanvexa landing page"
          title="Kanvexa landing page"
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg transition-colors hover:bg-app active:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <BrandLogo decorative className="size-9" />
          {expanded && (
            <span className="text-lg font-semibold tracking-tight text-ink">
              Kanvexa
            </span>
          )}
        </Link>
        {desktop && (
          <div className={expanded ? 'ml-auto' : ''}>{toggleButton}</div>
        )}
      </div>
      <div
        id={itemsId}
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto pb-2 ${expanded ? 'px-3' : 'px-2'}`}
      >
        <SidebarNavContent
          groups={groups}
          activeItemId={activeItemId}
          expanded={expanded}
        />
      </div>
      {footer && (
        <div
          className={`shrink-0 border-t border-line py-2 ${expanded ? 'px-3' : 'px-2'}`}
        >
          {footer(expanded)}
        </div>
      )}
    </nav>
  );
}

interface SidebarNavContentProps {
  groups: NavGroup[];
  activeItemId?: string;
  expanded: boolean;
  /** Touch layout for the mobile drawer: 44px rows. */
  roomy?: boolean;
}

/** Workspace slot and navigation groups, shared by the sidebar and the mobile drawer. */
export function SidebarNavContent({
  groups,
  activeItemId,
  expanded,
  roomy = false,
}: SidebarNavContentProps) {
  return (
    <div className="flex flex-col gap-1">
      <WorkspaceSwitcherSlot expanded={expanded} />
      {groups.map((group) => (
        <SidebarGroup
          key={group.id}
          group={group}
          activeItemId={activeItemId}
          expanded={expanded}
          roomy={roomy}
        />
      ))}
    </div>
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

interface SidebarGroupProps {
  group: NavGroup;
  activeItemId?: string;
  expanded: boolean;
  roomy: boolean;
}

function SidebarGroup({
  group,
  activeItemId,
  expanded,
  roomy,
}: SidebarGroupProps) {
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
            roomy={roomy}
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
  roomy: boolean;
}

function SidebarItem({ item, active, expanded, roomy }: SidebarItemProps) {
  const { icon: Icon, label } = item;
  const layout = `flex ${roomy ? 'min-h-11' : 'min-h-10'} w-full items-center gap-2.5 rounded-lg ${expanded ? 'px-3 text-left' : 'justify-center'}`;

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
