import { PageContainer } from '../../../components/PageContainer';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { usePreferences } from '../../settings/hooks';
import { useHomeDashboard } from './hooks';
import { HomeGreeting } from './HomeGreeting';
import { SummaryTiles } from './SummaryTiles';
import './home.css';

export function HomePage() {
  usePageTitle('Home');
  const { user } = useAuth();
  const preferences = usePreferences();
  const timeZone = preferences.data?.timeZone;
  const dashboard = useHomeDashboard(timeZone);
  const home = dashboard.home;
  const error = isApiError(dashboard.error) ? dashboard.error : undefined;
  const offline =
    preferences.fetchStatus === 'paused' || dashboard.fetchStatus === 'paused';
  const failed = preferences.isError || dashboard.isError;

  return (
    <PageContainer>
      <div className="home-page">
        <HomeGreeting
          name={user?.displayName}
          timeZone={timeZone}
          dateFormat={preferences.data?.dateFormat}
        />
        {offline && !home ? (
          <p role="status" className="home-notice">
            You appear to be offline. Home will reload when you reconnect.
          </p>
        ) : failed && !home ? (
          <div role="alert" className="home-notice">
            {error?.status === 0
              ? 'You appear to be offline. Reconnect and try again.'
              : error && [403, 404].includes(error.status)
                ? 'Your access may have changed. Reload your Home.'
                : 'Your Home is unavailable right now.'}{' '}
            <button
              type="button"
              className="home-link"
              onClick={() => {
                void preferences.refetch();
                void dashboard.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : !home || !preferences.data ? (
          <HomeSkeleton />
        ) : (
          <>
            <SummaryTiles summary={home.summary} />
            {dashboard.isRefetchError && (
              <p role="status" className="home-refresh-error">
                Could not refresh Home.{' '}
                <button
                  type="button"
                  className="home-link"
                  onClick={() => void dashboard.refetch()}
                >
                  Retry
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}

function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading your Home" className="home-skeleton">
      <div className="home-tiles">
        {[0, 1, 2, 3].map((item) => (
          <span key={item} className="home-tile home-shimmer" />
        ))}
      </div>
      <div className="home-columns">
        <span className="home-shimmer home-skeleton-panel" />
        <span className="home-shimmer home-skeleton-panel" />
      </div>
    </div>
  );
}
