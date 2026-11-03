import { CodeIcon, FolderIcon, UserIcon } from '../../../components/icons';
import { WorkflowPreview } from './ProductShowcases';
import { SectionIntro } from './SectionIntro';
import { landingContainer } from './layout';
const workflows = [
  {
    title: 'Product Teams',
    copy: 'Plan sprints, organize tasks and collaborate across projects.',
    board: 'Product Sprint',
    tasks: ['Plan the roadmap', 'Build the interface', 'Ship the release'],
    Icon: CodeIcon,
  },
  {
    title: 'Student Projects',
    copy: 'Coordinate group assignments, deadlines and shared work.',
    board: 'Course Project',
    tasks: ['Gather research', 'Draft the report', 'Review together'],
    Icon: FolderIcon,
  },
  {
    title: 'Personal Planning',
    copy: 'Keep ideas, daily plans and tasks organized in one place.',
    board: 'Weekly Plan',
    tasks: ['Plan the week', 'Learn something new', 'Finish a project'],
    Icon: UserIcon,
  },
];
export function WorkflowsSection() {
  return (
    <section aria-labelledby="workflows-title" className="landing-workflows">
      <div className={landingContainer}>
        <SectionIntro
          titleId="workflows-title"
          eyebrow="Built for every workflow"
          title="One workspace. Endless possibilities."
        >
          Flexible enough for different teams, from product development to
          personal planning.
        </SectionIntro>
        <ul className="landing-workflow-grid">
          {workflows.map(({ title, copy, board, tasks, Icon }, index) => (
            <li className={`workflow-${index}`} key={title}>
              <div>
                <Icon />
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
              <WorkflowPreview name={board} tasks={tasks} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
