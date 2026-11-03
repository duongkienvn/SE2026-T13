import {
  BoltIcon,
  ColumnsIcon,
  TeamIcon,
  CheckSquareIcon,
  TagIcon,
  PaperclipIcon,
} from '../../../components/icons';
import { landingContainer, landingSection } from './layout';
import { SectionIntro } from './SectionIntro';
const features = [
  {
    title: 'Visual boards',
    copy: 'Organize tasks, ideas and projects with a flexible Kanban workflow.',
    Icon: ColumnsIcon,
  },
  {
    title: 'Realtime collaboration',
    copy: 'See updates instantly and work together in real time.',
    Icon: BoltIcon,
  },
  {
    title: 'Workspaces & permissions',
    copy: 'Keep teams and projects organized with role-based access.',
    Icon: TeamIcon,
  },
  {
    title: 'Checklists',
    copy: 'Break down work into clear, trackable steps.',
    Icon: CheckSquareIcon,
  },
  {
    title: 'Labels & dates',
    copy: 'Categorize work and keep the next deadline in sight.',
    Icon: TagIcon,
  },
  {
    title: 'Attachments',
    copy: 'Link resources or upload files securely and easily.',
    Icon: PaperclipIcon,
  },
];
export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className={`${landingSection} landing-features`}
    >
      <div className={landingContainer}>
        <SectionIntro
          titleId="features-title"
          eyebrow="Features"
          title="Everything you need to stay on track"
        >
          Powerful features to plan, collaborate and get things done together.
        </SectionIntro>
        <ul className="landing-feature-grid">
          {features.map(({ title, copy, Icon }) => (
            <li key={title}>
              <span className="landing-feature-icon">
                <Icon />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
