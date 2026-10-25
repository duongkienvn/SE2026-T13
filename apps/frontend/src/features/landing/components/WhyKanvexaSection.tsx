import type { ComponentType } from 'react';
import {
  ColumnsIcon,
  TargetIcon,
  TeamIcon,
  TrendIcon,
  type IconProps,
} from '../../../components/icons';
import { landingContainer, landingSection } from './layout';
import { SectionIntro } from './SectionIntro';
import { ShowcasePreview } from './ShowcasePreview';

const POINTS: {
  title: string;
  description: string;
  Icon: ComponentType<IconProps>;
}[] = [
  {
    title: 'Create boards for any project',
    description: 'Give each project its own board, columns and members.',
    Icon: ColumnsIcon,
  },
  {
    title: 'Collaborate with your team',
    description: 'Work on the same board together and see updates live.',
    Icon: TeamIcon,
  },
  {
    title: 'Track progress with clarity',
    description:
      'Due dates, assignees and activity show what is happening and what is next.',
    Icon: TrendIcon,
  },
  {
    title: 'Focus on what matters',
    description:
      'A clean, distraction-free workspace built for getting work done.',
    Icon: TargetIcon,
  },
];

/** The V1 product showcase; it is the `Why Kanvexa` anchor target. */
export function WhyKanvexaSection() {
  return (
    <section
      id="why-kanvexa"
      aria-labelledby="why-kanvexa-title"
      className={`${landingSection} relative isolate overflow-hidden py-20 lg:py-24`}
    >
      <div
        aria-hidden="true"
        className="absolute top-1/2 -left-40 -z-10 size-[720px] -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(146_148_252/0.22),transparent)]"
      />
      <div
        className={`${landingContainer} grid items-center gap-12 lg:grid-cols-2 lg:gap-16`}
      >
        <div className="order-2 lg:order-1">
          <ShowcasePreview />
        </div>

        <div className="order-1 lg:order-2">
          <SectionIntro
            titleId="why-kanvexa-title"
            eyebrow="Built for real teams"
            title="A better way to manage your work"
            align="start"
          >
            From early ideas to final delivery, Kanvexa helps teams stay
            organized, productive and connected, all in one place.
          </SectionIntro>
          <ul className="mt-8 space-y-5">
            {POINTS.map(({ title, description, Icon }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-ink">{title}</h3>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
