import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../../components/Brand';
import { CloseIcon, MenuIcon } from '../../../components/icons';
import { LANDING_SECTIONS } from '../sections';
import type { LandingSession } from '../useLandingSession';
import { LandingHeaderActions } from './LandingActions';
import { landingContainer } from './layout';

const sectionLinkClass =
  'rounded-md text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Sticky public header; below `lg` the anchors and actions move into a menu panel. */
export function LandingHeader({ session }: { session: LandingSession }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/85 backdrop-blur-md">
      <div className={`${landingContainer} flex h-16 items-center gap-6`}>
        <Link
          to="/"
          aria-label="Kanvexa home"
          className="rounded-lg text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Brand size="sm" />
        </Link>

        <nav aria-label="Sections" className="mx-auto hidden lg:block">
          <ul className="flex items-center gap-8">
            {LANDING_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className={sectionLinkClass}>
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <LandingHeaderActions
          session={session}
          className="hidden items-center gap-3 lg:flex"
        />

        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="landing-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
          className="ml-auto grid size-10 place-items-center rounded-lg text-ink hover:bg-app focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:hidden"
        >
          {menuOpen ? (
            <CloseIcon className="size-6" />
          ) : (
            <MenuIcon className="size-6" />
          )}
        </button>
      </div>

      {/* Overlays the page instead of pushing it, so anchor offsets stay correct. */}
      <div
        id="landing-menu"
        hidden={!menuOpen}
        className="absolute inset-x-0 top-full border-b border-line bg-surface shadow-frame lg:hidden"
      >
        <nav aria-label="Sections" className={`${landingContainer} py-3`}>
          <ul>
            {LANDING_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={closeMenu}
                  className={`${sectionLinkClass} block py-3 text-base`}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
          <LandingHeaderActions
            session={session}
            onNavigate={closeMenu}
            className="mt-2 grid gap-3 border-t border-line pt-4 pb-2 sm:flex"
          />
        </nav>
      </div>
    </header>
  );
}
