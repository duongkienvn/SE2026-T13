import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { SoonBadge } from '../../../app/layout/SoonBadge';
import { ChevronLeftIcon, ChevronRightIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { usePageTitle } from '../../../hooks/usePageTitle';
import {
  settingsPath,
  settingsSections,
  type SettingsSection,
} from '../sections';

/** Below this width Settings is a section list plus full-width detail pages. */
export const SETTINGS_DESKTOP_QUERY = '(min-width: 768px)';

function useIsDesktop() {
  return useMediaQuery(SETTINGS_DESKTOP_QUERY, true);
}

function isSettingsIndex(pathname: string) {
  return pathname.replace(/\/+$/, '') === '/settings';
}

/** Account Settings: section rail and content on desktop, list and detail on phones. */
export function SettingsLayout() {
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();

  if (!isDesktop) {
    return (
      <PageContainer>
        {!isSettingsIndex(pathname) && (
          <Link
            to="/settings"
            className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            <ChevronLeftIcon className="size-4" />
            Back to Settings
          </Link>
        )}
        <Outlet />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="grid grid-cols-[13rem_minmax(0,1fr)] items-start gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Settings">
          <p className="px-3 pb-2 text-sm font-medium text-muted">Settings</p>
          <ul className="space-y-1">
            {settingsSections.map((section) => (
              <RailItem key={section.id} section={section} />
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </PageContainer>
  );
}

/** `/settings`: the section list on phones; desktop opens Profile. */
export function SettingsIndex() {
  usePageTitle('Settings');
  const isDesktop = useIsDesktop();
  if (isDesktop) return <Navigate to="profile" replace />;

  return (
    <>
      <h1 className="text-2xl leading-tight font-bold tracking-tight text-ink">
        Settings
      </h1>
      <nav aria-label="Settings" className="mt-4">
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {settingsSections.map((section) => (
            <ListItem key={section.id} section={section} />
          ))}
        </ul>
      </nav>
    </>
  );
}

const railLayout = 'flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm';

function RailItem({ section }: { section: SettingsSection }) {
  const Icon = section.icon;
  if (section.availability === 'soon') {
    return (
      <li
        title={`${section.label} — coming soon`}
        className={`${railLayout} cursor-default font-medium text-muted/70`}
      >
        <Icon className="size-4.5 shrink-0" />
        <span className="min-w-0 truncate">{section.label}</span>
        <span className="ml-auto">
          <SoonBadge />
        </span>
        <span className="sr-only">, coming soon</span>
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={settingsPath(section)}
        className={({ isActive }) =>
          `${railLayout} transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
            isActive
              ? 'bg-primary-soft font-semibold text-primary'
              : 'font-medium text-muted hover:bg-app hover:text-ink'
          }`
        }
      >
        <Icon className="size-4.5 shrink-0" />
        <span className="min-w-0 truncate">{section.label}</span>
      </NavLink>
    </li>
  );
}

const listLayout = 'flex min-h-15 items-center gap-3 px-4 py-2.5';

function ListItem({ section }: { section: SettingsSection }) {
  const Icon = section.icon;
  const text = (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[15px] font-medium">
        {section.label}
      </span>
      <span className="block truncate text-xs text-muted">
        {section.summary}
      </span>
    </span>
  );

  if (section.availability === 'soon') {
    return (
      <li
        title={`${section.label} — coming soon`}
        className={`${listLayout} cursor-default text-muted/70`}
      >
        <Icon className="size-5 shrink-0" />
        {text}
        <SoonBadge />
        <span className="sr-only">, coming soon</span>
      </li>
    );
  }

  return (
    <li>
      <Link
        to={settingsPath(section)}
        className={`${listLayout} text-ink hover:bg-app focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary`}
      >
        <Icon className="size-5 shrink-0 text-muted" />
        {text}
        <ChevronRightIcon className="size-4 shrink-0 text-muted" />
      </Link>
    </li>
  );
}
