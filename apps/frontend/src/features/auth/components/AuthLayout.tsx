import type { ReactNode } from 'react';
import { Brand } from '../../../components/Brand';
import { BoardPreviewIllustration } from './BoardPreviewIllustration';

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Shared auth frame with viewport-bounded sizing independent of form content.
 * Auto margins center short forms and let longer forms scroll from the top.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-auth-backdrop bg-[linear-gradient(to_right,rgb(255_255_255/0.45)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.45)_1px,transparent_1px)] bg-[size:120px_120px] dark:bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] p-4 sm:p-6">
      <div className="flex h-[calc(100dvh-2rem)] w-full max-w-[1380px] overflow-hidden rounded-[20px] bg-surface shadow-frame sm:h-[min(720px,calc(100dvh-3rem))]">
        <aside className="relative hidden w-[48%] shrink-0 overflow-hidden bg-linear-to-b from-auth-panel-from to-auth-panel-to px-[6.5%] pt-[clamp(2.5rem,9dvh,4.5rem)] lg:block">
          <Brand size="lg" className="text-ink" />
          <p className="mt-[clamp(1.5rem,5dvh,2.5rem)] max-w-[300px] text-[26px] leading-[1.2] font-semibold tracking-tight text-ink">
            Organize work. Move ideas forward.
          </p>
          <p className="mt-3 max-w-[360px] text-base leading-relaxed text-muted">
            Plan, track, and collaborate with Kanban boards built for modern
            teams.
          </p>
          <BoardPreviewIllustration className="absolute bottom-0 left-[11%] h-[42%] w-[89%]" />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain px-6 py-6 short:py-4 sm:px-10 sm:py-8 lg:px-12 xl:px-16 [scrollbar-gutter:stable]">
          <div className="mx-auto my-auto w-full max-w-[560px] shrink-0 [overflow-wrap:anywhere]">
            {/* The side panel already shows the brand on large screens. */}
            <Brand className="mb-6 text-ink lg:hidden" />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
