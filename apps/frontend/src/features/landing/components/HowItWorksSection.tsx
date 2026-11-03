import {
  FolderIcon,
  ColumnsIcon,
  UsersIcon,
  ArrowRightIcon,
} from '../../../components/icons';
import { landingContainer, landingSection } from './layout';
import { SectionIntro } from './SectionIntro';
const steps = [
  {
    title: 'Create a workspace',
    copy: 'Set up a workspace for your team or project.',
    Icon: FolderIcon,
  },
  {
    title: 'Organize your boards',
    copy: 'Create boards, columns and cards to structure your work.',
    Icon: ColumnsIcon,
  },
  {
    title: 'Collaborate in real time',
    copy: 'Invite teammates, make updates and move work forward together.',
    Icon: UsersIcon,
  },
];
export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className={`${landingSection} landing-steps`}
    >
      <div className={landingContainer}>
        <div className="landing-steps-panel">
          <SectionIntro
            titleId="how-it-works-title"
            eyebrow="How it works"
            title="Get your team up and running in minutes"
          >
            A simple flow to organize work, collaborate and make progress
            together.
          </SectionIntro>
          <ol>
            {steps.map(({ title, copy, Icon }, index) => (
              <li key={title}>
                <span className="landing-step-icon">
                  <Icon />
                </span>
                <div>
                  <h3>
                    <span className="landing-step-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="sr-only">Step {index + 1}: </span>
                    {title}
                  </h3>
                  <p>{copy}</p>
                </div>
                {index < 2 && <ArrowRightIcon className="landing-step-arrow" />}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
