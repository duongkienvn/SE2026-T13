import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../../components/Brand';
import { GitHubIcon } from '../../../components/icons';
import { LANDING_SECTIONS } from '../sections';
import type { LandingSession } from '../useLandingSession';
import { landingContainer } from './layout';

const REPOSITORY_URL = 'https://github.com/duongkienvn/SE2026-T13';

const linkClass =
  'rounded-sm text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

/** Only links with a working destination: anchors, auth pages and the public repository. */
export function LandingFooter({ session }: { session: LandingSession }) {
  return (
    <footer className="border-t border-line bg-surface">
      <div
        className={`${landingContainer} grid grid-cols-3 gap-x-4 gap-y-8 sm:gap-x-6 py-12 lg:grid-cols-[2fr_1fr_1fr_1fr]`}
      >
        <div className="col-span-3 lg:col-span-1">
          <Brand size="sm" className="text-ink" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
            A Kanban workspace for teams who want to organize work and move
            together in real time.
          </p>
        </div>

        <FooterColumn title="Product">
          {LANDING_SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className={linkClass}>
                {section.label}
              </a>
            </li>
          ))}
        </FooterColumn>

        <FooterColumn title="Account">
          {session === 'member' && (
            <li>
              <Link to="/boards" className={linkClass}>
                Your boards
              </Link>
            </li>
          )}
          {session === 'guest' && (
            <>
              <li>
                <Link to="/login" className={linkClass}>
                  Log in
                </Link>
              </li>
              <li>
                <Link to="/register" className={linkClass}>
                  Sign up
                </Link>
              </li>
            </>
          )}
        </FooterColumn>

        <FooterColumn title="Project">
          <li>
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkClass} inline-flex items-center gap-1.5`}
            >
              <GitHubIcon className="size-4" />
              GitHub
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        </FooterColumn>
      </div>
      <div className="border-t border-line">
        <p
          className={`${landingContainer} flex flex-wrap justify-between gap-2 py-5 text-xs text-muted`}
        >
          <span>
            © {new Date().getFullYear()} Kanvexa. All rights reserved.
          </span>
          <span>Built for collaboration.</span>
        </p>
      </div>
    </footer>
  );
}
