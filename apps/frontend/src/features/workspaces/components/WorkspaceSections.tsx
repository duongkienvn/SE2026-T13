import { NavLink } from 'react-router';
import { SoonBadge } from '../../../app/layout/SoonBadge';
import { workspaceSections } from '../navigation';

export function WorkspaceSections({
  workspaceId,
  compact = false,
}: {
  workspaceId: string;
  compact?: boolean;
}) {
  return (
    <nav
      aria-label={compact ? 'Workspace pages' : 'Workspace sections'}
      className={
        compact ? 'mt-1 ml-4 border-l border-line pl-2' : 'border-b border-line'
      }
    >
      <ul
        className={
          compact
            ? 'space-y-0.5'
            : 'grid grid-cols-2 sm:flex sm:flex-wrap sm:gap-2'
        }
      >
        {workspaceSections(workspaceId).map((item) => {
          const Icon = item.icon;
          const classes = `flex min-h-11 items-center gap-2 text-sm ${compact ? 'rounded-lg px-3' : 'border-b-2 px-3 sm:px-4'}`;
          return (
            <li key={item.id} className="min-w-0">
              {item.availability === 'available' ? (
                <NavLink
                  end
                  to={item.path}
                  className={({ isActive }) =>
                    `${classes} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${isActive ? 'border-primary bg-primary-soft/40 font-medium text-primary' : 'border-transparent text-muted hover:text-ink'}`
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </NavLink>
              ) : (
                <span
                  aria-disabled="true"
                  className={`${classes} border-transparent text-muted`}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                  <SoonBadge />
                  <span className="sr-only">, coming soon</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
