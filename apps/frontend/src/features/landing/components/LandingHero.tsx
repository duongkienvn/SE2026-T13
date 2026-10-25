import type { ComponentType } from 'react';
import { buttonClassName } from '../../../components/Button';
import {
  ArrowDownIcon,
  BoltIcon,
  ShieldCheckIcon,
  TeamIcon,
  type IconProps,
} from '../../../components/icons';
import type { LandingSession } from '../useLandingSession';
import { BoardPreview } from './BoardPreview';
import { PrimaryAction } from './LandingActions';
import { landingContainer } from './layout';

const HIGHLIGHTS: { label: string; Icon: ComponentType<IconProps> }[] = [
  { label: 'Real-time collaboration', Icon: BoltIcon },
  { label: 'Built for teams', Icon: TeamIcon },
  { label: 'Owner and member roles', Icon: ShieldCheckIcon },
];

/** Hand-drawn style note from the mockup, kept as inline SVG + italic Inter. */
function HandNote() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -top-12 right-10 hidden items-end gap-1 text-primary/80 xl:flex"
    >
      <svg
        viewBox="0 0 48 40"
        className="mb-1 size-10 -scale-x-100"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M44 4C30 6 14 14 8 34" />
        <path d="m3 27 5 8 7-6" />
      </svg>
      <p className="max-w-44 text-sm leading-snug italic">
        Plan, track, and build together in real time
      </p>
    </div>
  );
}

export function LandingHero({ session }: { session: LandingSession }) {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden bg-linear-to-b from-[#f4f4ff] to-surface"
    >
      <div
        aria-hidden="true"
        className="absolute -top-40 -left-32 -z-10 size-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(146_148_252/0.22),transparent)]"
      />
      <div
        aria-hidden="true"
        className="absolute top-10 -right-24 -z-10 size-[640px] rounded-full bg-[radial-gradient(closest-side,rgb(146_148_252/0.28),transparent)]"
      />
      {/* Fades the glows out so the hero meets the white page without an edge. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 -z-10 h-28 bg-linear-to-b from-transparent to-surface"
      />

      <div
        className={`${landingContainer} grid items-center gap-12 pt-10 pb-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10 lg:pt-12 lg:pb-16 short:lg:pt-8 short:lg:pb-12`}
      >
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
            The next way to collaborate
          </p>
          <h1
            id="hero-title"
            className="mt-4 text-[44px] leading-[1.05] font-bold tracking-tight text-ink sm:text-[56px] xl:text-[64px] short:lg:text-[52px]"
          >
            Organize work.
            <span className="block text-primary">Move together.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-muted short:lg:mt-4 short:lg:text-base">
            A clean Kanban workspace to plan tasks, track progress, and keep
            your team in sync, with every change showing up for everyone in real
            time.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 short:lg:mt-6">
            <PrimaryAction session={session} />
            <a href="#features" className={buttonClassName('secondary', 'lg')}>
              Learn more
              <ArrowDownIcon className="size-4" />
            </a>
          </div>
          <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-3 short:lg:mt-6">
            {HIGHLIGHTS.map(({ label, Icon }) => (
              <li
                key={label}
                className="flex items-center gap-2.5 text-[13px] leading-tight text-muted"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <Icon className="size-4.5" />
                </span>
                <span className="max-w-24">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative lg:pl-4">
          <HandNote />
          <div
            aria-hidden="true"
            className="absolute -inset-6 -z-10 rounded-[48px] bg-[radial-gradient(closest-side,rgb(97_92_247/0.18),transparent)] blur-2xl"
          />
          <BoardPreview className="lg:[transform:perspective(1800px)_rotateY(-9deg)_rotateX(3deg)]" />
        </div>
      </div>
    </section>
  );
}
