import { ChevronDownIcon } from '../../../components/icons';
import { landingContainer, landingSection } from './layout';
import { SectionIntro } from './SectionIntro';
const questions = [
  [
    'Is Kanvexa free to use?',
    'Yes. Create an account and start organizing your work for free. The current app has no paid subscription tiers.',
  ],
  [
    'Does Kanvexa support realtime collaboration?',
    'Yes. Board changes, comments and presence update in real time so everyone can stay in sync.',
  ],
  [
    'Can I invite my team members?',
    'Yes. Invite people to a workspace and manage access with Workspace and Board roles. Private boards keep their own membership.',
  ],
  [
    'Can I use Kanvexa on mobile?',
    'Yes. Kanvexa adapts to smaller screens, with mobile navigation and responsive boards and Card Detail.',
  ],
  [
    'Is my data secure?',
    'Workspace and Board permissions control access. Private boards are limited to their members, and file downloads require authorized access.',
  ],
  [
    "What's next for Kanvexa?",
    'More personal planning and work-discovery tools are on the roadmap. Follow the project on GitHub for progress and release updates.',
  ],
];
export function FaqSection() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className={`${landingSection} landing-faq`}
    >
      <div className={landingContainer}>
        <SectionIntro
          titleId="faq-title"
          eyebrow="FAQ"
          title="Frequently asked questions"
        >
          Quick answers to common questions about Kanvexa.
        </SectionIntro>
        <div className="landing-faq-grid">
          {questions.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <ChevronDownIcon />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
