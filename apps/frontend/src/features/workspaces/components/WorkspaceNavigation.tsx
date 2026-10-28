import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useMatch } from 'react-router';
import {
  ChevronDownIcon,
  LayersIcon,
  PlusIcon,
} from '../../../components/icons';
import { useWorkspaceDirectory } from '../hooks';
import { workspacePath } from '../navigation';
import { WorkspaceAvatar } from './WorkspaceIdentity';
import { WorkspaceSections } from './WorkspaceSections';

const linkStyle =
  'flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary hover:bg-app';

export function WorkspaceSwitcher({ expanded }: { expanded: boolean }) {
  const query = useWorkspaceDirectory();
  const match = useMatch('/workspaces/:workspaceId/*');
  const current = query.workspaces.find(
    (item) => item.id === match?.params.workspaceId,
  );
  const details = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => {
    if (details.current) details.current.open = false;
  }, [location.key]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node))
        details.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  // Compact rails use the real discovery picker; a flyout inside the rail's
  // scroll container would be clipped. The drawer keeps the full selector.
  if (!expanded)
    return (
      <Link
        to="/workspaces"
        aria-label="Choose workspace"
        title="Choose workspace"
        className="mb-1 flex min-h-12 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
      >
        <WorkspaceAvatar workspace={current} className="size-8 text-sm" />
      </Link>
    );
  return (
    <details
      ref={details}
      className="group relative mb-1"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && details.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          details.current.open = false;
          details.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label={
          current ? `Switch workspace, ${current.name}` : 'Choose workspace'
        }
        className={`flex min-h-12 cursor-pointer list-none items-center gap-2.5 rounded-xl border border-line bg-app/50 focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden ${expanded ? 'px-3 py-2.5' : 'justify-center py-2'}`}
      >
        <WorkspaceAvatar workspace={current} className="size-8 text-sm" />
        {expanded && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                {current?.name ?? 'Workspaces'}
              </span>
              <span className="block text-xs text-muted">
                {current
                  ? current.type === 'PERSONAL'
                    ? 'Personal workspace'
                    : 'Team workspace'
                  : 'Choose a workspace'}
              </span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted group-open:rotate-180" />
          </>
        )}
      </summary>
      <div
        className={`z-30 mt-2 rounded-xl border border-line bg-surface p-2 shadow-frame ${expanded ? '' : 'absolute top-0 left-full ml-2 w-64'}`}
      >
        <p className="px-3 py-2 text-xs font-semibold text-muted">
          SWITCH WORKSPACE
        </p>
        <div className="max-h-64 overflow-y-auto">
          {query.workspaces.map((item) => (
            <Link
              key={item.id}
              to={workspacePath(item.id)}
              aria-current={item.id === current?.id ? 'location' : undefined}
              className={`${linkStyle} ${item.id === current?.id ? 'bg-primary-soft text-primary' : 'text-ink'}`}
            >
              <WorkspaceAvatar workspace={item} className="size-7 text-xs" />
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                {item.name}
                <span className="block text-xs text-muted">
                  {item.type === 'PERSONAL' ? 'Personal' : 'Team'}
                </span>
              </span>
              {item.id === current?.id && <span aria-hidden="true">✓</span>}
            </Link>
          ))}
          {query.state !== 'ready' && (
            <p className="px-3 py-3 text-xs leading-relaxed text-muted">
              {query.state === 'loading'
                ? 'Loading workspaces…'
                : query.state === 'unavailable'
                  ? 'Workspace services are not available yet.'
                  : 'Workspaces could not be loaded.'}
            </p>
          )}
          {query.state === 'ready' && !query.workspaces.length && (
            <p className="px-3 py-3 text-xs text-muted">
              No workspace memberships yet.
            </p>
          )}
        </div>
        <div className="mt-2 border-t border-line pt-2">
          <Link to="/workspaces" className={`${linkStyle} text-ink`}>
            <LayersIcon className="size-4" />
            All workspaces
          </Link>
          <Link
            to="/workspaces?create=team"
            className={`${linkStyle} text-primary`}
          >
            <PlusIcon className="size-4" />
            Create Workspace
          </Link>
        </div>
      </div>
    </details>
  );
}

export function WorkspaceNavigation({ expanded }: { expanded: boolean }) {
  const query = useWorkspaceDirectory();
  const match = useMatch('/workspaces/:workspaceId/*');
  const { pathname } = useLocation();
  const [open, setOpen] = useState(true);
  const itemsId = useId();
  return (
    <div>
      {expanded && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={itemsId}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 w-full items-center justify-between px-3 text-xs font-semibold tracking-wide text-muted uppercase focus-visible:outline-2 focus-visible:outline-primary"
        >
          Workspaces
          <ChevronDownIcon className={`size-4 ${open ? '' : '-rotate-90'}`} />
        </button>
      )}
      {(!expanded || open) && (
        <div id={itemsId}>
          <Link
            to="/workspaces"
            aria-label={expanded ? undefined : 'All workspaces'}
            title={expanded ? undefined : 'All workspaces'}
            aria-current={pathname === '/workspaces' ? 'page' : undefined}
            className={`${linkStyle} ${expanded ? '' : 'justify-center px-0'} ${pathname === '/workspaces' ? 'bg-primary-soft font-medium text-primary' : 'text-muted'}`}
          >
            <LayersIcon className="size-5 shrink-0" />
            {expanded && 'All workspaces'}
          </Link>
          {expanded && (
            <>
              {(['PERSONAL', 'TEAM'] as const).map((type) => (
                <div key={type} className="mt-3">
                  <p className="px-3 pb-1 text-xs text-muted">
                    {type === 'PERSONAL'
                      ? 'Personal workspace'
                      : 'Team workspaces'}
                  </p>
                  {query.workspaces
                    .filter((item) => item.type === type)
                    .map((item) => (
                      <div key={item.id}>
                        <Link
                          to={workspacePath(item.id)}
                          aria-current={
                            item.id === match?.params.workspaceId
                              ? 'location'
                              : undefined
                          }
                          className={`${linkStyle} ${item.id === match?.params.workspaceId ? 'bg-app font-medium text-ink' : 'text-muted'}`}
                        >
                          <WorkspaceAvatar
                            workspace={item}
                            className="size-6 rounded-md text-xs"
                          />
                          <span className="min-w-0 truncate" title={item.name}>
                            {item.name}
                          </span>
                        </Link>
                        {item.id === match?.params.workspaceId && (
                          <WorkspaceSections workspaceId={item.id} compact />
                        )}
                      </div>
                    ))}
                  {!query.workspaces.some((item) => item.type === type) && (
                    <p className="px-3 py-2 text-xs leading-relaxed text-muted">
                      {query.state === 'loading'
                        ? 'Loading…'
                        : query.state !== 'ready'
                          ? 'Unavailable'
                          : type === 'PERSONAL'
                            ? 'Your personal workspace is not available.'
                            : 'No team memberships yet.'}
                    </p>
                  )}
                </div>
              ))}
              <Link
                to="/workspaces?create=team"
                className={`${linkStyle} mt-2 text-muted`}
              >
                <PlusIcon className="size-4 shrink-0" />
                Create Workspace
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
