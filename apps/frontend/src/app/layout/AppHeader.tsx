import type { ReactNode } from 'react';

interface AppHeaderProps {
  /** Page context next to the brand, e.g. the current board name. */
  context?: ReactNode;
  /** Right-aligned actions, e.g. the signed-in user's menu. */
  actions?: ReactNode;
}

export function AppHeader({ context, actions }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 px-4 md:h-15 md:gap-5 md:px-6">
      <span className="text-lg font-semibold tracking-tight text-brand md:text-xl">
        Kanban
      </span>
      {context && (
        <>
          <span aria-hidden="true" className="h-6 w-px bg-line" />
          <div className="flex min-w-0 items-center gap-3 text-sm font-medium text-ink">
            {context}
          </div>
        </>
      )}
      {actions && (
        <div className="ml-auto flex items-center gap-4">{actions}</div>
      )}
    </header>
  );
}
