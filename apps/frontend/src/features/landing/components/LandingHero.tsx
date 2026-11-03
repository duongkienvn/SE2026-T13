import { buttonClassName } from '../../../components/Button';
import {
  ArrowRightIcon,
  BoltIcon,
  ShieldCheckIcon,
  TeamIcon,
} from '../../../components/icons';
import type { LandingSession } from '../useLandingSession';
import { BoardPreview } from './BoardPreview';
import { PrimaryAction } from './LandingActions';
import { landingContainer } from './layout';

export function LandingHero({ session }: { session: LandingSession }) {
  return (
    <section aria-labelledby="hero-title" className="landing-hero">
      <div className={`${landingContainer} landing-hero-grid`}>
        <div className="landing-hero-copy">
          <p className="landing-kicker">
            <BoltIcon /> Realtime Collaborative Kanban
          </p>
          <h1 id="hero-title">
            Turn ideas into real progress with <span>Kanvexa</span>
          </h1>
          <p className="landing-hero-lead">
            A modern, realtime Kanban for teams to plan, collaborate and ship
            faster. Organize your workspaces and keep everyone moving together.
          </p>
          <div className="landing-actions">
            <PrimaryAction session={session} />
            <a href="#features" className={buttonClassName('secondary', 'lg')}>
              Explore features <ArrowRightIcon className="size-4" />
            </a>
          </div>
          <ul className="landing-highlights">
            <li>
              <BoltIcon />
              <span>
                Realtime
                <br />
                collaboration
              </span>
            </li>
            <li>
              <TeamIcon />
              <span>
                Team
                <br />
                workspaces
              </span>
            </li>
            <li>
              <ShieldCheckIcon />
              <span>
                Private
                <br />
                &amp; secure
              </span>
            </li>
          </ul>
        </div>
        <div className="landing-showcase landing-hero-showcase">
          <BoardPreview />
        </div>
      </div>
    </section>
  );
}
