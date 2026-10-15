import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-bold tracking-tight text-ink md:text-[26px]">
          {title}
        </h1>
        {description && (
          // Clamped so a long board description can't push the page into
          // scrolling; the full text stays available as a tooltip and to
          // screen readers.
          <p
            title={description}
            className="mt-1 line-clamp-2 text-sm text-muted md:text-[15px]"
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      )}
    </div>
  );
}
