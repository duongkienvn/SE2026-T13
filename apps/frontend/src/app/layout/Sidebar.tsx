import { BrandLogo } from '../../components/Brand';
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
  return (
    <nav
      aria-label="Primary"
      className="flex w-14 shrink-0 flex-col border-r border-line bg-surface md:w-15"
    >
      <div className="grid h-14 shrink-0 place-items-center md:h-15">
        <BrandLogo className="size-12" />
      </div>
      <ul className="mt-3 flex flex-col">
        {primaryItems.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            active={item.id === activeItemId}
          />
        ))}
      </ul>
      <ul className="mt-auto mb-3 flex flex-col">
        {secondaryItems.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            active={item.id === activeItemId}
          />
        ))}
      </ul>
    </nav>
  );
}

interface SidebarItemProps {
  item: NavItem;
  active: boolean;
}

function SidebarItem({ item, active }: SidebarItemProps) {
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
        className={`grid h-12 w-full place-items-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${stateClasses}`}
      >
        <Icon className="size-5" />
      </button>
    </li>
  );
}
