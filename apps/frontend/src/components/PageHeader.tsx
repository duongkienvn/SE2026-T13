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
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-ink md:text-[32px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-base text-muted md:text-[17px]">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          {actions}
        </div>
      )}
    </div>
  );
}
