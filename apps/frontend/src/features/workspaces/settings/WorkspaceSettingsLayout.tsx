import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useParams,
} from 'react-router';
import { ChevronLeftIcon, ChevronRightIcon } from '../../../components/icons';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import {
  workspaceSettingsPath,
  workspaceSettingsSections,
  type WorkspaceSettingsSection,
} from './sections';

const DESKTOP = '(min-width: 768px)';

/** Workspace Settings: section rail beside content; a section list on phones. */
export function WorkspaceSettingsLayout() {
  const { workspaceId = '' } = useParams();
  const { pathname } = useLocation();
  const desktop = useMediaQuery(DESKTOP, true);
  const workspace = useWorkspacePage();
  const index = /\/settings\/?$/.test(pathname);
  usePageTitle(
    workspace.overview
      ? `${workspace.overview.workspace.name} · Settings`
      : 'Workspace settings',
  );
  const heading = (
    <header>
      <h2 className="text-2xl font-semibold tracking-tight text-ink">
        Settings
      </h2>
      <p className="mt-1 text-sm text-muted">
        Manage your workspace settings and preferences.
      </p>
    </header>
  );

  if (!desktop)
    return (
      <section aria-label="Workspace settings" className="space-y-4">
        {index ? (
          <>
            {heading}
            <nav aria-label="Workspace settings sections">
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                {workspaceSettingsSections.map((section) => (
                  <ListItem
                    key={section.id}
                    section={section}
                    to={workspaceSettingsPath(workspaceId, section.id)}
                  />
                ))}
              </ul>
            </nav>
          </>
        ) : (
          <>
            <Link
              to={workspaceSettingsPath(workspaceId)}
              className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
            >
              <ChevronLeftIcon className="size-4" />
              Back to Settings
            </Link>
            <Outlet context={workspace} />
          </>
        )}
      </section>
    );

  return (
    <section aria-label="Workspace settings" className="space-y-5">
      {heading}
      <div className="grid grid-cols-[13rem_minmax(0,1fr)] items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <nav
          aria-label="Workspace settings sections"
          className="rounded-xl border border-line bg-surface p-2 shadow-card"
        >
          <ul className="space-y-1">
            {workspaceSettingsSections.map((section) => {
              const Icon = section.icon;
              return (
                <li key={section.id}>
                  <NavLink
                    to={workspaceSettingsPath(workspaceId, section.id)}
                    className={({ isActive }) =>
                      `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                        isActive
                          ? 'bg-primary-soft font-semibold text-primary'
                          : section.danger
                            ? 'font-medium text-danger hover:bg-danger/5'
                            : 'font-medium text-muted hover:bg-app hover:text-ink'
                      }`
                    }
                  >
                    <Icon className="size-4.5 shrink-0" />
                    <span className="min-w-0">{section.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">
          {index ? (
            <Navigate
              to={workspaceSettingsPath(workspaceId, 'general')}
              replace
            />
          ) : (
            <Outlet context={workspace} />
          )}
        </div>
      </div>
    </section>
  );
}

function ListItem({
  section,
  to,
}: {
  section: WorkspaceSettingsSection;
  to: string;
}) {
  const Icon = section.icon;
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-15 items-center gap-3 px-4 py-2.5 text-ink hover:bg-app focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <Icon
          className={`size-5 shrink-0 ${section.danger ? 'text-danger' : 'text-muted'}`}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[15px] font-medium ${section.danger ? 'text-danger' : ''}`}
          >
            {section.label}
          </span>
          <span className="block text-xs text-muted">{section.summary}</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted" />
      </Link>
    </li>
  );
}

/** Shared card frame for each section's content. */
export function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}
