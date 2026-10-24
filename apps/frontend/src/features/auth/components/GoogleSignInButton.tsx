import { useEffect, useRef, useState } from 'react';
import { Alert } from '../../../components/Alert';
import { useAuthSession } from '../auth-session-context';
import {
  getGoogleClientId,
  loadGoogleIdentity,
  renderGoogleButton,
} from '../google-identity';

interface Props {
  /** Snapshot at the deliberate button click, before Google opens its popup. */
  onStart: () => ((credential: string) => Promise<void>) | undefined;
  disabled?: boolean;
}

export function GoogleSignInButton({ onStart, disabled = false }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const scope = useAuthSession();
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const props = useRef({ onStart, disabled });
  // Capture the latest password/disabled state at click time without reinitializing GIS.
  useEffect(() => {
    props.current = { onStart, disabled };
  }, [onStart, disabled]);
  const clientId = getGoogleClientId();

  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    let request: ((credential: string) => Promise<void>) | undefined;
    let inFlight = false;
    const current = () => alive && scope.isCurrent();
    loadGoogleIdentity()
      .then((api) => {
        if (!current() || !element.current) return;
        dispose = renderGoogleButton(
          api,
          clientId,
          element.current,
          (credential) => {
            if (!current() || inFlight || props.current.disabled || !request)
              return;
            const execute = request;
            request = undefined; // Ignore duplicate callbacks for a single click.
            inFlight = true;
            setBusy(true);
            setMessage(undefined);
            void execute(credential)
              .catch(() => {
                if (current())
                  setMessage(
                    'Google sign-in could not complete. Please try again.',
                  );
              })
              .finally(() => {
                inFlight = false;
                if (current()) setBusy(false);
              });
          },
          () => {
            if (!current() || inFlight || props.current.disabled) {
              request = undefined;
              return;
            }
            request = props.current.onStart();
            if (request)
              setMessage(
                'Complete the Google popup. If it closes or is blocked, try again or use email and password.',
              );
          },
        );
        setStatus('ready');
      })
      .catch(() => {
        if (current()) setStatus('failed');
      });
    return () => {
      alive = false;
      request = undefined;
      dispose?.();
    };
  }, [clientId, scope]);

  if (!clientId)
    return (
      <p className="mt-4 text-center text-sm text-muted">
        Google sign-in is not configured. Use email and password.
      </p>
    );
  return (
    <div className="mt-4 space-y-2" aria-busy={busy}>
      <div
        className="flex items-center gap-3 text-xs text-muted"
        aria-hidden="true"
      >
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex min-h-10 justify-center" inert={disabled || busy}>
        <div ref={element} className="max-w-full" />
      </div>
      {status === 'loading' && (
        <p role="status" className="text-center text-sm text-muted">
          Loading Google sign-in…
        </p>
      )}
      {status === 'failed' && (
        <Alert variant="error">
          Google sign-in could not load. Use email and password or reload to
          retry.
        </Alert>
      )}
      {busy && (
        <p role="status" className="text-center text-sm text-muted">
          Confirming Google account…
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
