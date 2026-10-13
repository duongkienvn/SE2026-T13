import { Link } from 'react-router';

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
  return (
    <>
      <div className="my-7 flex items-center gap-4 text-sm text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <p className="flex min-h-[52px] items-center justify-center gap-2 rounded-lg border border-line px-4 text-[15px] text-ink">
        {prompt}
        <Link
          to={to}
          className="font-medium text-primary-hover underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          {action}
        </Link>
      </p>
    </>
  );
}
