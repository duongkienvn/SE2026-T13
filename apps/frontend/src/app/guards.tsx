import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState, LoadingState } from '../components/states';
import { useAuth } from '../features/auth/useAuth';
import { safeRedirectPath, type RedirectState } from './redirect';

function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-app px-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function SessionCheckScreen() {
  return (
    <FullPageMessage>
      <LoadingState label="Checking your session…" />
    </FullPageMessage>
  );
}

/** Renders protected routes only once the stored session has been verified. */
export function RequireAuth() {
  const { status, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <SessionCheckScreen />;
  }
  if (status === 'error') {
    return (
      <FullPageMessage>
        <ErrorState
          title="We couldn't verify your session"
          description="The server could not be reached or had a problem. You are still signed in on this tab."
          onRetry={retry}
        />
      </FullPageMessage>
    );
  }
  if (status === 'anonymous') {
    const state: RedirectState = {
      from: `${location.pathname}${location.search}${location.hash}`,
    };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/** Login/register are only for signed-out users; signed-in users continue to their intended page. */
export function PublicOnly() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <SessionCheckScreen />;
  }
  if (status === 'authenticated') {
    const from = (location.state as RedirectState | null)?.from;
    return <Navigate to={safeRedirectPath(from)} replace />;
  }
  return <Outlet />;
}

export function RootRedirect() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <SessionCheckScreen />;
  }
  return (
    <Navigate to={status === 'anonymous' ? '/login' : '/boards'} replace />
  );
}
