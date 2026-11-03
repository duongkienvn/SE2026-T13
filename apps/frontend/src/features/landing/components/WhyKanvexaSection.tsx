import { landingContainer, landingSection } from './layout';
import { BenefitList, CardDetailShowcase } from './ProductShowcases';
export function WhyKanvexaSection() {
  return (
    <section
      id="why-kanvexa"
      aria-labelledby="why-title"
      className={`${landingSection} landing-split-section landing-why`}
    >
      <div className={`${landingContainer} landing-split-grid`}>
        <div className="landing-showcase">
          <CardDetailShowcase />
        </div>
        <div className="landing-split-copy">
          <p className="landing-eyebrow">Why Kanvexa?</p>
          <h2 id="why-title">A better way to manage your work</h2>
          <p>
            More than a task board, a fast, collaborative and secure workspace
            for your team.
          </p>
          <BenefitList
            items={[
              'Realtime updates and presence',
              'Flexible boards, cards and workflows',
              'Rich cards with checklists, labels, dates and attachments',
              'Workspace and role-based access control',
              'Clean, modern and easy to use',
            ]}
          />
        </div>
      </div>
    </section>
  );
}
