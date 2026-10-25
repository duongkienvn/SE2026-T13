import { Link } from 'react-router';
import { buttonClassName } from '../../../components/Button';
import type { LandingSession } from '../useLandingSession';

/** Same box as a button, shown while the stored session is verified so nothing jumps. */
function ActionPlaceholder({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-10 w-32 animate-pulse rounded-lg bg-line/70 motion-reduce:animate-none ${className}`}
    />
  );
}

/** Header actions: Log in + Get Started for guests, Go to Boards once signed in. */
export function LandingHeaderActions({
  session,
  onNavigate,
  className = '',
}: {
  session: LandingSession;
  onNavigate?: () => void;
  className?: string;
}) {
  if (session === 'pending') {
    return (
      <div className={className}>
        <ActionPlaceholder />
      </div>
    );
  }
  if (session === 'member') {
    return (
      <div className={className}>
        <Link to="/boards" onClick={onNavigate} className={buttonClassName()}>
          Go to Boards
        </Link>
      </div>
    );
  }
  return (
    <div className={className}>
      <Link
        to="/login"
        onClick={onNavigate}
        className={buttonClassName('secondary')}
      >
        Log in
      </Link>
      <Link to="/register" onClick={onNavigate} className={buttonClassName()}>
        Get Started
      </Link>
    </div>
  );
}
