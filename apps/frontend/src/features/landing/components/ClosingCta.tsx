import { Link } from 'react-router';
import { buttonClassName } from '../../../components/Button';
import type { LandingSession } from '../useLandingSession';
import { PrimaryAction } from './LandingActions';
import { landingContainer } from './layout';

/** Decorative initials, not real customers. */
const AVATARS = [
  { initials: 'AM', className: 'bg-primary-soft text-primary' },
  { initials: 'SL', className: 'bg-[#e7f6ee] text-success dark:bg-[#123222]' },
  {
    initials: 'JK',
    className:
      'bg-[#fdeedd] text-[#b45309] dark:bg-[#3a2814] dark:text-[#f0a35e]',
  },
];

function Illustration() {
  return (
    <div
      aria-hidden="true"
      className="relative hidden h-40 w-72 shrink-0 text-primary/80 lg:block"
    >
      <p className="absolute top-6 left-0 max-w-28 text-sm leading-snug italic">
        Turn ideas into progress
      </p>
      <svg
        viewBox="0 0 120 60"
        className="absolute top-16 left-10 w-28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M4 8c10 34 44 46 70 30 12-8 6-24-4-16-8 7 6 22 40 18" />
        <path d="m104 32 7 7-9 3" />
      </svg>
      <div className="absolute top-0 right-0 flex -space-x-2 rounded-full bg-surface/70 p-2 shadow-card">
        {AVATARS.map((avatar) => (
          <span
            key={avatar.initials}
            className={`grid size-12 place-items-center rounded-full text-sm font-semibold ring-4 ring-surface ${avatar.className}`}
          >
            {avatar.initials}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ClosingCta({ session }: { session: LandingSession }) {
  const member = session === 'member';
  return (
    <section aria-labelledby="cta-title" className="pb-16 lg:pb-20">
      <div className={landingContainer}>
        <div className="flex items-center justify-between gap-10 rounded-3xl border border-[#e3e3fb] bg-linear-to-br from-[#f3f3ff] via-[#efeffe] to-[#e5e6fd] dark:border-line dark:from-[#1a1f3a] dark:via-[#1b2040] dark:to-[#232856] px-6 py-10 sm:px-10 lg:px-12 lg:py-12">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              {member ? 'Welcome back' : 'Get started'}
            </p>
            <h2
              id="cta-title"
              className="mt-3 text-3xl leading-tight font-bold tracking-tight text-ink sm:text-[40px]"
            >
              Ready to work better{' '}
              <span className="text-[#3f3aa8] dark:text-[#a9a5ff]">
                together?
              </span>
            </h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              {member
                ? 'Your boards are one click away.'
                : 'Join Kanvexa and bring a simpler, more collaborative way to manage work to your team.'}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <PrimaryAction session={session} />
              {session === 'guest' && (
                <Link
                  to="/login"
                  className={buttonClassName('secondary', 'lg')}
                >
                  Log in
                </Link>
              )}
            </div>
          </div>
          <Illustration />
        </div>
      </div>
    </section>
  );
}
