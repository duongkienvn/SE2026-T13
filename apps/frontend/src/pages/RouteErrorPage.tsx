import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button, buttonClassName } from '../components/Button';
import { FullPageNotice } from '../components/FullPageNotice';
import { usePageTitle } from '../hooks/usePageTitle';
import { NotFoundPage } from './NotFoundPage';

/**
 * Replaces React Router's default error screen, which can show stack traces.
 * The error itself is never rendered; React Router already logs it in development.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // Set here too: this parent effect runs after NotFoundPage's own.
  usePageTitle(notFound ? 'Page not found' : 'Something went wrong');

  if (notFound) {
    return <NotFoundPage />;
  }

  return (
    <FullPageNotice
      title="Something went wrong"
      description="An unexpected error stopped this page from loading. Reloading usually fixes it."
      actions={
        <>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
          <Link to="/" reloadDocument className={buttonClassName('secondary')}>
            Go to home
          </Link>
        </>
      }
    />
  );
}
