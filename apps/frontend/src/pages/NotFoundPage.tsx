import { Link } from 'react-router';
import { buttonClassName } from '../components/Button';

export function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-app px-4 text-center">
      <div>
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="mt-2 text-[28px] font-bold tracking-tight text-ink">
          Page not found
        </h1>
        <p className="mt-2 text-muted">
          The page you are looking for does not exist.
        </p>
        <Link to="/" className={`mt-6 ${buttonClassName()}`}>
          Go to home
        </Link>
      </div>
    </main>
  );
}
