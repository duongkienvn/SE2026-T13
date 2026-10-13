import { APP_NAME } from '@kanban/shared';
import { LogoIcon } from '../../components/icons';
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
      className="flex w-14 shrink-0 flex-col border-r border-line bg-surface md:w-[68px]"
    >
      <div
        className="grid h-16 shrink-0 place-items-center bg-brand-soft text-white md:h-[72px]"
        title={APP_NAME}
      >
        <LogoIcon className="size-6 md:size-7" />
      </div>
      <ul className="mt-4 flex flex-col">
        {primaryItems.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            active={item.id === activeItemId}
          />
        ))}
      </ul>
      <ul className="mt-auto mb-4 flex flex-col">
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
  const available = Boolean(onSelect);
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
        className={`grid h-14 w-full place-items-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${stateClasses}`}
      >
        <Icon className="size-6" />
      </button>
    </li>
  );
}
