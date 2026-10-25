import { useId, useState } from 'react';
import { BrandLogo } from '../../components/Brand';
import { ChevronRightIcon } from '../../components/icons';
import type { NavItem } from './navigation';

interface SidebarProps {
  primaryItems: NavItem[];
  secondaryItems: NavItem[];
  activeItemId?: string;
}

export function Sidebar({
  primaryItems,
  secondaryItems,
  activeItemId,
}: SidebarProps) {
  const [expanded, setExpanded] = useState(true);
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
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={expanded}
        aria-controls={itemsId}
        onClick={() => setExpanded((value) => !value)}
        className="mx-1 my-2 flex min-h-10 shrink-0 items-center justify-center gap-3 rounded-lg text-sm text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
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
        <ul className="flex flex-col">
          {primaryItems.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              active={item.id === activeItemId}
              expanded={expanded}
            />
          ))}
        </ul>
        {secondaryItems.length > 0 && (
          <ul className="mt-auto mb-3 flex flex-col">
            {secondaryItems.map((item) => (
              <SidebarItem
                key={item.id}
                item={item}
                active={item.id === activeItemId}
                expanded={expanded}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

interface SidebarItemProps {
  item: NavItem;
  active: boolean;
  expanded: boolean;
}

function SidebarItem({ item, active, expanded }: SidebarItemProps) {
  const { icon: Icon, label, onSelect } = item;
  // The current page is never "coming soon", even before its handler is wired.
  const available = active || Boolean(onSelect);
  const stateClasses = active
    ? 'bg-primary-soft text-primary shadow-[inset_-3px_0_0_var(--color-primary)]'
    : available
      ? 'text-muted hover:bg-app hover:text-ink'
      : 'cursor-not-allowed text-muted';

  return (
    <li>
      <button
        type="button"
        aria-label={available ? label : `${label} (coming soon)`}
        aria-current={active ? 'page' : undefined}
        aria-disabled={available ? undefined : true}
        title={available ? label : `${label} — coming soon`}
        onClick={onSelect}
        className={`flex min-h-12 w-full items-center gap-3 py-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${expanded ? 'px-5 text-left' : 'justify-center'} ${stateClasses}`}
      >
        <Icon className="size-5 shrink-0" />
        {expanded && <span className="text-sm font-medium">{label}</span>}
      </button>
    </li>
  );
}
