import type { ReactNode } from 'react';

interface AppHeaderProps {
  /** Page context next to the brand, e.g. the current board name. */
  context?: ReactNode;
  /** Right-aligned actions, e.g. the signed-in user's menu. */
  actions?: ReactNode;
}

export function AppHeader({ context, actions }: AppHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 px-4 md:h-[72px] md:gap-6 md:px-7">
      <span className="text-xl font-semibold tracking-tight text-brand md:text-[22px]">
        Kanban
      </span>
      {context && (
        <>
          <span aria-hidden="true" className="h-8 w-px bg-line" />
          <div className="flex min-w-0 items-center gap-3 text-[15px] font-medium text-ink">
            {context}
          </div>
        </>
      )}
      {actions && (
        <div className="ml-auto flex items-center gap-4 md:gap-6">
          {actions}
        </div>
      )}
    </header>
  );
}
