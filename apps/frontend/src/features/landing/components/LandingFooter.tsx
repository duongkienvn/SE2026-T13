import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../../components/Brand';
import { GitHubIcon } from '../../../components/icons';
import { LANDING_SECTIONS } from '../sections';
import type { LandingSession } from '../useLandingSession';
import { landingContainer } from './layout';
const repo = 'https://github.com/duongkienvn/SE2026-T13';
const linkClass =
  'rounded-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2>{title}</h2>
      <ul>{children}</ul>
    </div>
  );
}
export function LandingFooter({ session }: { session: LandingSession }) {
  return (
    <footer className="landing-footer">
      <div className={`${landingContainer} landing-footer-grid`}>
        <div>
          <Link to="/" aria-label="Kanvexa home" className={linkClass}>
            <Brand size="sm" />
          </Link>
          <p>
            A modern Kanban workspace for teams who want to organize work and
            move together.
          </p>
          <a
            href={repo}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Kanvexa on GitHub (opens in a new tab)"
            className={`${linkClass} mt-2 inline-flex`}
          >
            <GitHubIcon className="size-4" />
          </a>
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
        <FooterColumn title="Resources">
          <li>
            <a
              href={`${repo}/blob/main/README.md`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Documentation
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
          <li>
            <a
              href={repo}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        </FooterColumn>
        <FooterColumn title="Company">
          <li>
            <a href="#why-kanvexa" className={linkClass}>
              About Kanvexa
            </a>
          </li>
          {session === 'member' ? (
            <li>
              <Link to="/boards" className={linkClass}>
                Your boards
              </Link>
            </li>
          ) : session === 'guest' ? (
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
          ) : null}
        </FooterColumn>
      </div>
      <div className={`${landingContainer} landing-footer-meta`}>
        <span>© {new Date().getFullYear()} Kanvexa. All rights reserved.</span>
        <span>Built for collaboration.</span>
      </div>
    </footer>
  );
}
