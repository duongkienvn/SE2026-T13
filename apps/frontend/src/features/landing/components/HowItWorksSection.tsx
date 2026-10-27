import type { ComponentType } from 'react';
import {
  BoltIcon,
  ColumnsIcon,
  LayersIcon,
  type IconProps,
} from '../../../components/icons';
import { landingContainer, landingSection } from './layout';
import { SectionIntro } from './SectionIntro';

const STEPS: {
  title: string;
  description: string;
  Icon: ComponentType<IconProps>;
}[] = [
  {
    title: 'Create a board',
    description:
      'Start a board for a project and add the columns your team works in.',
    Icon: ColumnsIcon,
  },
  {
    title: 'Organize tasks',
    description:
      'Add cards with descriptions, due dates and assignees, then move them as work progresses.',
    Icon: LayersIcon,
  },
  {
    title: 'Collaborate in real time',
    description:
      'Add teammates, see who is on the board and watch changes appear as they happen.',
    Icon: BoltIcon,
  },
];

/** Approved V1.1 addition: a compact strip, not a long tutorial. */
export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className={`${landingSection} bg-[#f8f8ff] py-16 dark:bg-[#0c1020] lg:py-20`}
    >
      <div className={landingContainer}>
        <SectionIntro
          titleId="how-it-works-title"
          eyebrow="Three simple steps"
          title="How it works"
        >
          From an empty board to a team that moves together.
        </SectionIntro>

        <ol className="mt-12 grid gap-8 md:grid-cols-3 md:gap-6">
          {STEPS.map(({ title, description, Icon }, index) => (
            <li
              key={title}
              className="flex items-start gap-4 md:flex-col md:items-stretch md:gap-5"
            >
              <div aria-hidden="true" className="flex items-center">
                <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-solid text-white shadow-[0_10px_24px_-10px_rgb(97_92_247/0.8)]">
                  <Icon className="size-6" />
                  <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-surface text-[11px] font-bold text-primary ring-1 ring-line">
                    {index + 1}
                  </span>
                </span>
                {index < STEPS.length - 1 && (
                  <span className="mx-4 hidden h-0 flex-1 border-t-2 border-dashed border-primary/25 md:block" />
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink">
                  <span className="sr-only">Step {index + 1}: </span>
                  {title}
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
