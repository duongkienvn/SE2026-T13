import type { ReactNode } from 'react';

interface CardDetailSectionProps {
  icon: ReactNode;
  title: string;
  /** Count or progress next to the heading. */
  meta?: ReactNode;
  /** The section's own Add/Edit control; omitted when read-only. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * One block of the Card Detail main column (description, checklists,
 * attachments, comments). Each feature owns its section and its actions, so
 * later blocks slot in without touching the layout.
 */
export function CardDetailSection({
  icon,
  title,
  meta,
  action,
  children,
}: CardDetailSectionProps) {
  return (
    <section className="min-w-0">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
        <span aria-hidden="true" className="text-muted [&>svg]:size-5">
          {icon}
        </span>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {meta}
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      <div className="mt-3 min-w-0 sm:pl-8">{children}</div>
    </section>
  );
}

/** A labelled group of the side rail (members, labels, dates, actions). */
export function CardRailGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

/** Compact text button used for in-section actions (Edit, Add, Remove). */
export const sectionActionClass =
  'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent';

/** Full-width side rail action (Duplicate, Copy link, Archive, Restore). */
export const railActionClass =
  'flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-left text-sm font-medium text-ink hover:bg-app focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted';
