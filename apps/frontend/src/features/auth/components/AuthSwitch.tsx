import { Link, useLocation } from 'react-router';
import type { RedirectState } from '../../../app/redirect';

/** The page switch follows the shared Google section's method divider. */
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
    <p className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm text-ink short:mt-4">
      {prompt}
      <Link
        to={to}
        state={state}
        className="font-medium text-primary-hover underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
      >
        {action}
      </Link>
    </p>
  );
}
