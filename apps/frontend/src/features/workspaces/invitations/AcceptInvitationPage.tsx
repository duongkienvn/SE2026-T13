import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { RedirectState } from '../../../app/redirect';
import { Alert } from '../../../components/Alert';
import { Brand } from '../../../components/Brand';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { LoadingState } from '../../../components/states';
import { MailIcon } from '../../../components/icons';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import {
  useAcceptWorkspaceInvitation,
  useDeclineWorkspaceInvitation,
} from '../members/hooks';
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
  focusTitle = false,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
  focusTitle?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) heading.current?.focus();
  }, [focusTitle]);
  return (
    <main className="grid min-h-dvh place-items-center bg-app px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <Brand size="sm" className="text-ink" />
        <span className="mt-6 grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
          <MailIcon className="size-6" />
        </span>
        <h1
          ref={heading}
          tabIndex={focusTitle ? -1 : undefined}
          className="mt-4 text-2xl font-semibold tracking-tight text-ink"
        >
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
    if (error.status === 401)
      return 'Your session has ended. Sign in again and reopen the invitation link.';
  }
  return 'We couldn’t complete your request. Check your connection and try again.';
}

/**
 * Landing page for the invitation email. Opening it never joins anything:
 * the signed-in, verified recipient must press Accept.
 */
export function AcceptInvitationPage() {
  const location = useLocation();
  const entry = (location.state as { invitationEntry?: string } | null)
    ?.invitationEntry;
  // Replacing the fragment keeps this entry mounted; a new link or bare visit
  // starts a new flow, including fresh mutation state.
  return (
    <InvitationEntry
      key={
        location.hash || location.search
          ? location.key
          : (entry ?? location.key)
      }
    />
  );
}

function InvitationEntry() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, user, signOut, retry } = useAuth();
  const scope = useAuthSession();
  const boundGeneration = useRef<number | null>(null);
  if (status !== 'anonymous' && boundGeneration.current === null)
    boundGeneration.current = scope.generation;
  const sessionChanged =
    boundGeneration.current !== null &&
    boundGeneration.current !== scope.generation;
  const [proof, setProof] = useState(() =>
    location.hash
      ? readProofFragment(location.hash)
      : invitationProof.get(new URLSearchParams(location.search).get('resume')),
  );
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null);
  const [returnId] = useState(() => crypto.randomUUID());
  usePageTitle('Workspace invitation');
  useEffect(() => {
    // A handoff is single-use. Only the non-secret entry marker reaches state.
    invitationProof.clear();
    if (location.hash || location.search)
      void navigate(INVITATION_ACCEPT_PATH, {
        replace: true,
        state: { invitationEntry: location.key },
      });
  }, [location.hash, location.search, location.key, navigate]);

  useEffect(() => {
    if (sessionChanged) {
      invitationProof.clear();
      setProof(null);
      setOutcome(null);
    }
  }, [sessionChanged]);

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

  if (outcome && !sessionChanged)
    return (
      <Card
        focusTitle
        title={
          outcome === 'accepted'
            ? 'You joined the workspace'
            : 'Invitation declined'
        }
        description={
          <p>
            {outcome === 'accepted'
              ? 'Welcome aboard. The workspace is now in your Workspaces list.'
              : 'You declined this invitation.'}
          </p>
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

  if (!proof || sessionChanged)
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
    const state: RedirectState = {
      from: `${INVITATION_ACCEPT_PATH}?resume=${returnId}`,
    };
    return (
      <Card
        title="You’re invited to a workspace"
        description={
          <>
            <p>
              Sign in with the email address this invitation was sent to. You
              can review and accept or decline it after signing in.
            </p>
            <p>
              New to Kanvexa? Create an account with that address, verify it,
              then open the invitation link again.
            </p>
            <p>
              After Google sign-in or a page reload, open the email link again.
            </p>
          </>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            to="/login"
            state={state}
            onClick={() => invitationProof.set(proof, returnId)}
            className={`${linkClass} flex-1 bg-primary-solid text-white hover:bg-primary-solid-hover`}
          >
            Sign in
          </Link>
          <Link
            to="/register"
            state={{ from: INVITATION_ACCEPT_PATH } satisfies RedirectState}
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
      onSwitchAccount={() => {
        invitationProof.clear();
        setProof(null);
        signOut();
      }}
      onComplete={(result) => {
        invitationProof.clear();
        setProof(null);
        setOutcome(result);
      }}
    />
  );
}

function AcceptInvitation({
  proof,
  email,
  onSwitchAccount,
  onComplete,
}: {
  proof: string;
  email: string;
  onSwitchAccount: () => void;
  onComplete: (result: 'accepted' | 'declined') => void;
}) {
  const accept = useAcceptWorkspaceInvitation();
  const decline = useDeclineWorkspaceInvitation();
  const scope = useAuthSession();
  const [confirming, setConfirming] = useState(false);
  const busy = useRef(false);
  const pending = accept.isPending || decline.isPending;
  const submit = (action: 'accepted' | 'declined') => {
    if (busy.current || !scope.isCurrent()) return;
    busy.current = true;
    const mutation = action === 'accepted' ? accept : decline;
    mutation.mutate(proof, {
      onSuccess: () => {
        if (scope.isCurrent()) onComplete(action);
      },
      onSettled: () => {
        busy.current = false;
      },
    });
  };
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
        disabled={pending}
        onClick={() => submit('accepted')}
      >
        {accept.isPending ? 'Joining…' : 'Accept invitation'}
      </Button>
      <Button
        size="lg"
        variant="secondary"
        className="w-full"
        disabled={pending}
        onClick={() => {
          decline.reset();
          setConfirming(true);
        }}
      >
        Decline invitation
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
          disabled={pending}
          onClick={onSwitchAccount}
          className={`${linkClass} flex-1 text-primary-hover hover:bg-app disabled:cursor-not-allowed disabled:text-muted`}
        >
          Use a different account
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          open
          title="Decline invitation?"
          description="You will not join this workspace."
          confirmLabel="Decline invitation"
          pendingLabel="Declining…"
          pending={pending}
          error={decline.isError ? failure(decline.error) : undefined}
          onCancel={() => setConfirming(false)}
          onConfirm={() => submit('declined')}
        />
      )}
    </Card>
  );
}
