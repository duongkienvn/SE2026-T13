import type { ReactNode } from 'react';
import { Brand } from '../../../components/Brand';
import { ForwardTogetherIllustration } from './ForwardTogetherIllustration';

/** Login and registration only; recovery and verification keep AuthLayout. */
export function AuthEntryLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-entry" data-auth-entry>
      <div className="auth-entry-frame">
        <aside className="auth-entry-hero" aria-label="About Kanvexa">
          <Brand size="lg" />
          <div className="auth-entry-story">
            <p className="auth-entry-statement">
              Organize work.
              <br />
              Move ideas forward.
            </p>
            <p className="auth-entry-description">
              Plan, track, and collaborate with Kanban boards built for modern
              teams.
            </p>
          </div>
          <ForwardTogetherIllustration />
        </aside>
        <main className="auth-entry-main">
          <div className="auth-entry-content">
            <Brand className="auth-entry-mobile-brand" />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
