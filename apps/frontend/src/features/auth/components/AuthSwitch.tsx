import { Link, useLocation } from 'react-router';
import type { RedirectState } from '../../../app/redirect';

/** "or" divider plus a link to the other auth page, as in login.png. */
export function AuthSwitch({
  prompt,
  to,
  action,
}: {
  prompt: string;
  to: string;
  action: string;
}) {
  // Keep the page the user originally wanted while switching between login and register.
  const from = (useLocation().state as RedirectState | null)?.from;
  const state: RedirectState | undefined = from ? { from } : undefined;

  return (
    <>
      <div className="my-4 flex items-center short:my-2.5 gap-4 text-sm text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <p className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm text-ink">
        {prompt}
        <Link
          to={to}
          state={state}
          className="font-medium text-primary-hover underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          {action}
        </Link>
      </p>
    </>
  );
}
