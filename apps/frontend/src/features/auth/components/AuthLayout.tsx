import type { ReactNode } from 'react';
import { BrandMarkIcon } from '../../../components/icons';
import { BoardPreviewIllustration } from './BoardPreviewIllustration';

interface AuthLayoutProps {
  children: ReactNode;
}

export function BrandLockup({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div
      className={`flex items-center font-semibold tracking-tight text-primary ${
        size === 'lg' ? 'gap-5 text-[40px]' : 'gap-4 text-[34px]'
      }`}
    >
      <BrandMarkIcon
        className={size === 'lg' ? 'size-10 text-brand-soft' : 'size-9'}
      />
      <span>Kanban</span>
    </div>
  );
}

/** Two-panel frame shared by the login and register pages (login.png). */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-auth-backdrop bg-[linear-gradient(to_right,rgb(255_255_255/0.45)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.45)_1px,transparent_1px)] bg-[size:120px_120px] px-4 py-8 sm:px-6 lg:py-16">
      <div className="flex w-full max-w-[1280px] overflow-hidden rounded-[20px] bg-surface shadow-frame lg:min-h-[778px]">
        <aside className="relative hidden w-[52%] shrink-0 overflow-hidden bg-linear-to-b from-auth-panel-from to-auth-panel-to px-[7.5%] pt-[90px] lg:block">
          <BrandLockup size="lg" />
          <p className="mt-12 max-w-[340px] text-[32px] leading-[1.15] font-semibold tracking-tight text-ink">
            Organize work. Move ideas forward.
          </p>
          <p className="mt-5 max-w-[400px] text-xl leading-relaxed text-muted">
            Plan, track, and collaborate with Kanban boards built for modern
            teams.
          </p>
          <BoardPreviewIllustration className="absolute bottom-0 left-[11%] h-[380px] w-[89%]" />
        </aside>

        <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-12 lg:justify-start lg:px-[9%]">
          <div className="w-full max-w-[422px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
