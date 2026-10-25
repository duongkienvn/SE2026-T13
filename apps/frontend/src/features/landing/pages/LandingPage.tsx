import { useEffect } from 'react';
import { FeaturesSection } from '../components/FeaturesSection';
import { HowItWorksSection } from '../components/HowItWorksSection';
import { LandingHeader } from '../components/LandingHeader';
import { LandingHero } from '../components/LandingHero';
import { landingContainer, landingSection } from '../components/layout';
import { LANDING_TITLE } from '../sections';
import { useLandingSession } from '../useLandingSession';

/**
 * Public page at `/` for guests and signed-in users alike. Unlike the app
 * screens it scrolls; `data-landing` turns on smooth anchor scrolling in
 * style.css (unless the user prefers reduced motion).
 */
export function LandingPage() {
  const session = useLandingSession();

  useEffect(() => {
    document.title = LANDING_TITLE;
    // The browser looks for `/#features` before React has rendered it, so jump
    // once on mount. Later hash changes are native anchor navigation.
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) {
      document.getElementById(id)?.scrollIntoView?.({ behavior: 'instant' });
    }
  }, []);

  return (
    <div data-landing className="min-h-dvh bg-surface text-ink">
      <a
        href="#main-content"
        className="sr-only z-40 rounded-lg bg-surface px-4 py-2 font-medium text-primary shadow-card focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <LandingHeader session={session} />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <LandingHero session={session} />
        <FeaturesSection />
        <HowItWorksSection />
        <section
          id="why-kanvexa"
          aria-labelledby="why-kanvexa-title"
          className={`${landingSection} ${landingContainer} py-16`}
        >
          <h2 id="why-kanvexa-title" className="text-3xl font-bold">
            A better way to manage your work
          </h2>
        </section>
      </main>
    </div>
  );
}
