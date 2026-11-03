import type { LandingSession } from '../useLandingSession';
import { PrimaryAction } from './LandingActions';
import { landingContainer } from './layout';
export function ClosingCta({ session }: { session: LandingSession }) {
  return (
    <section aria-labelledby="cta-title" className="landing-closing">
      <div className={landingContainer}>
        <div className="landing-closing-panel">
          <div>
            <h2 id="cta-title">Ready to streamline your team's work?</h2>
            <p>
              {session === 'member'
                ? 'Your next step is waiting on your boards.'
                : 'Join Kanvexa today and turn your ideas into real progress.'}
            </p>
          </div>
          <PrimaryAction session={session} />
        </div>
      </div>
    </section>
  );
}
