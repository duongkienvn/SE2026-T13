import { landingContainer } from './layout';
import { BenefitList, RealtimeShowcase } from './ProductShowcases';
export function RealtimeSection() {
  return (
    <section aria-labelledby="realtime-title" className="landing-split-section">
      <div className={`${landingContainer} landing-split-grid`}>
        <div className="landing-split-copy">
          <p className="landing-live-label">
            <span />
            Live
          </p>
          <h2 id="realtime-title">
            Stay in sync.
            <br />
            Move forward together.
          </h2>
          <p>
            Collaborate with your team in real time, see who's online and keep
            everyone on the same page.
          </p>
          <BenefitList
            items={[
              "See who's viewing the board right now",
              'Changes update instantly for everyone',
              'Leave comments and discuss work in context',
              'Track activity and stay up to date',
            ]}
          />
        </div>
        <div className="landing-showcase">
          <RealtimeShowcase />
        </div>
      </div>
    </section>
  );
}
