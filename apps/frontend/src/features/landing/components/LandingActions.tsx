import { Link } from 'react-router';
import { buttonClassName } from '../../../components/Button';
import { ArrowRightIcon } from '../../../components/icons';
import type { LandingSession } from '../useLandingSession';

/** Same box as a button, shown while the stored session is verified so nothing jumps. */
function ActionPlaceholder({
  className = 'h-10 w-32',
}: {
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-pulse rounded-lg bg-line/70 motion-reduce:animate-none ${className}`}
    />
  );
}

/** The page's main call to action: sign up as a guest, open Boards once signed in. */
export function PrimaryAction({
  session,
  guestLabel = 'Get started',
}: {
  session: LandingSession;
  guestLabel?: string;
}) {
  if (session === 'pending') {
    return <ActionPlaceholder className="h-11 w-44" />;
  }
  const member = session === 'member';
  return (
    <Link
      to={member ? '/boards' : '/register'}
      className={buttonClassName('primary', 'lg')}
    >
      {member ? 'Go to your boards' : guestLabel}
      <ArrowRightIcon className="size-4" />
    </Link>
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
