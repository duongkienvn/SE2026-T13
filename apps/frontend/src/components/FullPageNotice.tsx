import type { ReactNode } from 'react';

interface FullPageNoticeProps {
  /** Small label above the title, e.g. "404". */
  eyebrow?: string;
  title: string;
  description: string;
  actions: ReactNode;
}

/** Centered full-screen message used outside the application shell. */
export function FullPageNotice({
  eyebrow,
  title,
  description,
  actions,
}: FullPageNoticeProps) {
  return (
    <main className="grid min-h-dvh place-items-center bg-app px-4 text-center">
      <div className="max-w-md">
        {eyebrow && (
          <p className="text-sm font-semibold text-primary">{eyebrow}</p>
        )}
        <h1 className="mt-2 text-[28px] font-bold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 text-muted">{description}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {actions}
        </div>
      </div>
    </main>
  );
}
