import type { ReactNode } from 'react';
import { Brand } from '../../../components/Brand';
import { BoardPreviewIllustration } from './BoardPreviewIllustration';

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Two-panel frame shared by the login and register pages (login.png). It is
 * sized to fit a laptop viewport so neither page needs to scroll.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-auth-backdrop short:py-2 bg-[linear-gradient(to_right,rgb(255_255_255/0.45)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.45)_1px,transparent_1px)] bg-[size:120px_120px] p-4 sm:px-6">
      <div className="flex w-full max-w-[1180px] overflow-hidden rounded-[20px] bg-surface shadow-frame lg:min-h-[min(600px,calc(100dvh-2rem))]">
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

        <main className="flex flex-1 items-center justify-center px-6 py-6 short:py-4 sm:px-10 lg:justify-start lg:px-[7%]">
          <div className="w-full max-w-[440px]">
            {/* The side panel already shows the brand on large screens. */}
            <Brand className="mb-6 text-ink lg:hidden" />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
