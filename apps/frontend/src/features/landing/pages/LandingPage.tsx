import { useEffect } from 'react';
import { ClosingCta } from '../components/ClosingCta';
import { FeaturesSection } from '../components/FeaturesSection';
import { HowItWorksSection } from '../components/HowItWorksSection';
import { LandingFooter } from '../components/LandingFooter';
import { LandingHeader } from '../components/LandingHeader';
import { LandingHero } from '../components/LandingHero';
import { WhyKanvexaSection } from '../components/WhyKanvexaSection';
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
        <WhyKanvexaSection />
        <ClosingCta session={session} />
      </main>
      <LandingFooter session={session} />
    </div>
  );
}
