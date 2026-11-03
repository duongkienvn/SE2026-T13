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
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        <span aria-hidden="true" className="text-muted [&>svg]:size-5">
          {icon}
        </span>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {meta}
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      <div className="mt-2 min-w-0 sm:pl-8">{children}</div>
    </section>
  );
}

/** A labelled group of the side rail (members, labels, dates, actions). */
export function CardRailGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        {icon && (
          <span aria-hidden="true" className="text-muted [&>svg]:size-4.5">
            {icon}
          </span>
        )}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Compact text button used for in-section actions (Edit, Add, Remove). */
export const sectionActionClass =
  'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent';

/** Full-width side rail action (Duplicate, Copy link, Archive, Restore). */
const railActionBase =
  'flex min-h-10 w-full items-center gap-2.5 rounded-lg border bg-surface px-3 text-left text-sm font-medium shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted';
export const railActionClass = `${railActionBase} border-line text-ink hover:bg-app`;
export const railDestructiveActionClass = `${railActionBase} border-danger/20 text-danger hover:bg-danger/5`;
