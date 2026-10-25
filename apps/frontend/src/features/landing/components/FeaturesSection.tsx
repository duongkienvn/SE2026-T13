import type { ComponentType } from 'react';
import {
  BoltIcon,
  ColumnsIcon,
  HistoryIcon,
  TeamIcon,
  type IconProps,
} from '../../../components/icons';
import { landingContainer, landingSection } from './layout';
import { SectionIntro } from './SectionIntro';

// Each claim maps to a shipped feature; see docs/tasks/frontend/public-landing-page.md.
const FEATURES: {
  title: string;
  description: string;
  Icon: ComponentType<IconProps>;
}[] = [
  {
    title: 'Visual boards',
    description:
      'Organize tasks in columns and cards, then drag them to where they belong.',
    Icon: ColumnsIcon,
  },
  {
    title: 'Real-time collaboration',
    description:
      'Changes to columns and cards show up for everyone on the board right away.',
    Icon: BoltIcon,
  },
  {
    title: 'Team management',
    description:
      'Add teammates to a board and choose who is an Owner and who is a Member.',
    Icon: TeamIcon,
  },
  {
    title: 'Activity history',
    description:
      'See who changed what on a board, from new cards to moved columns.',
    Icon: HistoryIcon,
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className={`${landingSection} py-20 lg:py-24`}
    >
      <div className={landingContainer}>
        <SectionIntro
          titleId="features-title"
          eyebrow="Features"
          title="Everything your team needs"
        >
          Kanvexa combines a clean{' '}
          <strong className="font-semibold text-ink">Kanban</strong> board with
          real-time collaboration, so your team can move faster and stay
          aligned.
        </SectionIntro>

        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ title, description, Icon }) => (
            <li
              key={title}
              className="rounded-2xl border border-line bg-surface p-6 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-20px_rgb(97_92_247/0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
                <Icon className="size-6" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-ink">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                {description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
