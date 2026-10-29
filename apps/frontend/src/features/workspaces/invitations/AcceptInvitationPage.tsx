import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { RedirectState } from '../../../app/redirect';
import { Alert } from '../../../components/Alert';
import { Brand } from '../../../components/Brand';
import { Button } from '../../../components/Button';
import { LoadingState } from '../../../components/states';
import { MailIcon } from '../../../components/icons';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAcceptWorkspaceInvitation } from '../members/hooks';
import {
  INVITATION_ACCEPT_PATH,
  invitationProof,
  readProofFragment,
} from './proof-store';

const linkClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-app px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <Brand size="sm" className="text-ink" />
        <span className="mt-6 grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
          <MailIcon className="size-6" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
          {description}
        </div>
        {children && <div className="mt-6 space-y-4">{children}</div>}
      </div>
    </main>
  );
}

function failure(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 400 || error.status === 410)
      return 'This invitation can’t be used. It may have expired, been revoked or already used, or it was sent to a different email address. Sign in with the invited address or ask an admin for a new invitation.';
    if (error.status === 403)
      return 'Verify your email address first, then open the invitation link again.';
    if (error.status === 409)
      return 'This invitation email has not been confirmed as sent yet. Ask a workspace admin to send it again.';
    if (error.status === 429)
      return 'Too many attempts. Wait a minute and try again.';
  }
  return 'We couldn’t accept the invitation. Check your connection and try again.';
}

/**
 * Landing page for the invitation email. Opening it never joins anything:
 * the signed-in, verified recipient must press Accept.
 */
export function AcceptInvitationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, user, signOut, retry } = useAuth();
  // Take the proof out of the fragment once, on first render.
  const [proof] = useState(() => {
    const fresh = readProofFragment(location.hash);
    if (fresh) invitationProof.set(fresh);
    return invitationProof.get();
  });
  usePageTitle('Workspace invitation');
  useEffect(() => {
    // Drop the fragment from the address bar and this history entry.
    if (location.hash)
      void navigate(INVITATION_ACCEPT_PATH, { replace: true, state: null });
  }, [location.hash, navigate]);

  if (status === 'error')
    return (
      <Card
        title="We couldn’t check your session"
        description={<p>The server could not be reached. Try again.</p>}
      >
        <Button size="lg" className="w-full" onClick={retry}>
          Try again
        </Button>
      </Card>
    );
  if (status === 'loading')
    return (
      <main className="grid min-h-dvh place-items-center bg-app px-4">
        <div className="w-full max-w-md">
          <LoadingState label="Checking your session…" />
        </div>
      </main>
    );

  if (!proof)
    return (
      <Card
        title="Open your invitation link"
        description={
          <p>
            We couldn’t find an invitation here. Open the link in your
            invitation email again. For your security the link only works in the
            tab it was opened in.
          </p>
        }
      >
        <Link
          to={status === 'authenticated' ? '/workspaces' : '/login'}
          className={`${linkClass} w-full bg-primary-solid text-white hover:bg-primary-solid-hover`}
        >
          {status === 'authenticated' ? 'Go to workspaces' : 'Sign in'}
        </Link>
      </Card>
    );

  if (status === 'anonymous') {
    const state: RedirectState = { from: INVITATION_ACCEPT_PATH };
    return (
      <Card
        title="You’re invited to a workspace"
        description={
          <>
            <p>
              Sign in with the email address this invitation was sent to. You
              can review and accept it after signing in.
            </p>
            <p>
              New to Kanvexa? Create an account with that address, verify it,
              then open the invitation link again.
            </p>
          </>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            to="/login"
            state={state}
            className={`${linkClass} flex-1 bg-primary-solid text-white hover:bg-primary-solid-hover`}
          >
            Sign in
          </Link>
          <Link
            to="/register"
            state={state}
            className={`${linkClass} flex-1 border border-line text-ink hover:bg-app`}
          >
            Create account
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <AcceptInvitation
      key={user?.id}
      proof={proof}
      email={user?.email ?? ''}
      onSwitchAccount={() => signOut()}
    />
  );
}

function AcceptInvitation({
  proof,
  email,
  onSwitchAccount,
}: {
  proof: string;
  email: string;
  onSwitchAccount: () => void;
}) {
  const accept = useAcceptWorkspaceInvitation();
  if (accept.isSuccess)
    return (
      <Card
        title="You joined the workspace"
        description={
          <p>Welcome aboard. The workspace is now in your Workspaces list.</p>
        }
      >
        <Link
          to="/workspaces"
          className={`${linkClass} w-full bg-primary-solid text-white hover:bg-primary-solid-hover`}
        >
          Go to workspaces
        </Link>
      </Card>
    );
  return (
    <Card
      title="Join this workspace?"
      description={
        <>
          <p>
            You’re signed in as{' '}
            <strong className="font-medium break-all text-ink">{email}</strong>.
          </p>
          <p>The invitation only works for the address it was sent to.</p>
        </>
      }
    >
      {accept.isError && <Alert variant="error">{failure(accept.error)}</Alert>}
      <Button
        size="lg"
        className="w-full"
        disabled={accept.isPending}
        onClick={() => {
          if (accept.isPending) return;
          accept.mutate(proof, {
            onSuccess: () => invitationProof.clear(),
          });
        }}
      >
        {accept.isPending ? 'Joining…' : 'Accept invitation'}
      </Button>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          to="/workspaces"
          onClick={() => invitationProof.clear()}
          className={`${linkClass} flex-1 border border-line text-ink hover:bg-app`}
        >
          Not now
        </Link>
        <button
          type="button"
          disabled={accept.isPending}
          onClick={onSwitchAccount}
          className={`${linkClass} flex-1 text-primary-hover hover:bg-app disabled:cursor-not-allowed disabled:text-muted`}
        >
          Use a different account
        </button>
      </div>
    </Card>
  );
}
