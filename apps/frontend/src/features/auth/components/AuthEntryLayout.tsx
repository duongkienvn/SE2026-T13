import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../../components/Brand';
import { BoltIcon, LayersIcon, TeamIcon } from '../../../components/icons';
import { ForwardTogetherIllustration } from './ForwardTogetherIllustration';

/** Login and registration only; recovery and verification keep AuthLayout. */
export function AuthEntryLayout({
  children,
  kind = 'login',
}: {
  children: ReactNode;
  kind?: 'login' | 'register';
}) {
  const waveId = useId();
  return (
    <div className="auth-entry" data-auth-entry data-auth-kind={kind}>
      <div className="auth-entry-frame">
        <aside className="auth-entry-hero" aria-label="About Kanvexa">
          <svg
            className="auth-entry-wave"
            viewBox="0 0 780 320"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id={waveId} x1="0" y1="0" x2="1" y2=".4">
                <stop stopColor="#8964f5" stopOpacity=".65" />
                <stop offset=".58" stopColor="#615cf7" stopOpacity=".08" />
                <stop offset="1" stopColor="#7150dc" stopOpacity=".45" />
              </linearGradient>
            </defs>
            <path
              d="M0 240C220 70 400 85 780 185V320H0Z"
              fill={`url(#${waveId})`}
            />
          </svg>
          <Link
            to="/"
            aria-label="Kanvexa home"
            className="auth-entry-brand-link"
          >
            <Brand size="lg" />
          </Link>
          <div className="auth-entry-story">
            <p className="auth-entry-statement">
              Organize work.
              <br />
              <span>Move ideas forward.</span>
            </p>
            <p className="auth-entry-description">
              Plan, track, and collaborate with Kanban boards built for modern
              teams.
            </p>
          </div>
          <ForwardTogetherIllustration />
          <ul className="auth-entry-benefits" aria-label="Kanvexa features">
            <li>
              <BoltIcon />
              <span>
                Real-time
                <br />
                collaboration
              </span>
            </li>
            <li>
              <TeamIcon />
              <span>
                Built for
                <br />
                teams
              </span>
            </li>
            <li>
              <LayersIcon />
              <span>
                Flexible
                <br />
                workspaces
              </span>
            </li>
          </ul>
        </aside>
        <main className="auth-entry-main">
          <div className="auth-entry-content">
            <Link
              to="/"
              aria-label="Kanvexa home"
              className="auth-entry-brand-link auth-entry-mobile-brand"
            >
              <Brand />
            </Link>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
