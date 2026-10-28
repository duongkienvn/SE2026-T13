import { ActivityIcon, ArrowRightIcon } from '../../../components/icons';
import { SoonBadge } from '../../../app/layout/SoonBadge';

/** No Workspace activity contract exists. Retain the approved panel honestly. */
export function WorkspaceActivity() {
  return (
    <section
      aria-labelledby="workspace-activity"
      className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="workspace-activity" className="text-sm font-semibold text-ink">
          Activity
        </h2>
        <span
          aria-disabled="true"
          className="flex min-h-8 items-center gap-1.5 text-xs text-muted"
        >
          View all <ArrowRightIcon className="size-3.5" />
          <SoonBadge />
          <span className="sr-only">, coming soon</span>
        </span>
      </header>
      <div className="flex min-h-56 flex-col items-center justify-center rounded-lg bg-app/40 px-4 py-6 text-center">
        <span className="mb-3 grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
          <ActivityIcon className="size-6" />
        </span>
        <h3 className="text-sm font-medium text-ink">
          A little context, all in one place
        </h3>
        <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
          Workspace activity is coming soon. Board activity remains available
          inside each board.
        </p>
        <span className="mt-4">
          <SoonBadge />
        </span>
      </div>
    </section>
  );
}
