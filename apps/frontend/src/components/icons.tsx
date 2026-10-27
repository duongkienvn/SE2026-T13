import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

function StrokeSvg({ children, ...props }: IconProps) {
  return (
    <Svg
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </Svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </StrokeSvg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </StrokeSvg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.8-3.6 3.9-6 7.5-6s6.7 2.4 7.5 6" />
    </StrokeSvg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </StrokeSvg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M10.6 5.6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </StrokeSvg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="m6 9 6 6 6-6" />
    </StrokeSvg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="m15 18-6-6 6-6" />
    </StrokeSvg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="m9 18 6-6-6-6" />
    </StrokeSvg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm4.3 7.2a1 1 0 0 0-1.4-1.4L10.5 12.2 9 10.7a1 1 0 0 0-1.4 1.4l2.2 2.2a1 1 0 0 0 1.4 0z"
      />
    </Svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 6.5A2.5 2.5 0 0 1 5 4h4.2a1.5 1.5 0 0 1 1.1.48L12 6.3h7a2.5 2.5 0 0 1 2.5 2.5v9.7A2.5 2.5 0 0 1 19 21H5a2.5 2.5 0 0 1-2.5-2.5z" />
    </Svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2 19.2C2 15.8 5.1 13 9 13s7 2.8 7 6.2v.8H2z" />
      <circle cx="17.2" cy="8.6" r="2.8" />
      <path d="M17.6 13.1c2.6.3 4.4 2.5 4.4 5.2v1.7h-4.4v-.8c0-2.4-1-4.5-2.7-5.8.8-.2 1.7-.3 2.7-.3z" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <rect
          key={angle}
          x="10.25"
          y="1.5"
          width="3.5"
          height="5"
          rx="1"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <path
        fillRule="evenodd"
        d="M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zm0 4.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
      />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 4.5a1.25 1.25 0 0 0-1.25 1.25v5a1.25 1.25 0 0 0 2.5 0v-5A1.25 1.25 0 0 0 12 6.5zm0 9a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"
      />
    </Svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <Svg fill="none" {...props}>
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </StrokeSvg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <StrokeSvg strokeWidth="2.2" {...props}>
      <path d="M12 5v14M5 12h14" />
    </StrokeSvg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </StrokeSvg>
  );
}

/** Pulse line, as on the Activity heading in card-detail.png. */
export function ActivityIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </StrokeSvg>
  );
}

export function MoreVerticalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="5.5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="18.5" r="1.8" />
    </Svg>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v9a2.5 2.5 0 0 1-2.5 2.5h-6v1.5H16a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h2.5V18h-6A2.5 2.5 0 0 1 2 15.5v-9A2.5 2.5 0 0 1 4.5 4zm0 2a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5z"
      />
    </Svg>
  );
}

export function MegaphoneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 4.2v15.6a1 1 0 0 1-1.5.87L12.4 17H8.5l.9 3.6a1 1 0 0 1-1 1.4h-1a1 1 0 0 1-.97-.76L5.3 17H5a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3h7.4l5.1-3.67A1 1 0 0 1 19 4.2z" />
      <path d="M21 9.5a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0v-3a1 1 0 0 1 1-1z" />
    </Svg>
  );
}

export function BarChartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="12" width="4" height="8" rx="1.2" />
      <rect x="10" y="8" width="4" height="12" rx="1.2" />
      <rect x="16" y="4" width="4" height="16" rx="1.2" />
    </Svg>
  );
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M9 3h6a2 2 0 0 1 2 2v1h2.5A2.5 2.5 0 0 1 22 8.5v10a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-10A2.5 2.5 0 0 1 4.5 6H7V5a2 2 0 0 1 2-2zm0 3h6V5H9zM4 12.2v6.3a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-6.3A20 20 0 0 1 13 13.4V14a1 1 0 0 1-2 0v-.6a20 20 0 0 1-7-1.2zm0-2.15a18 18 0 0 0 16 0V8.5a.5.5 0 0 0-.5-.5h-15a.5.5 0 0 0-.5.5z"
      />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </StrokeSvg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </StrokeSvg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </StrokeSvg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M12 5v14m-6-6 6 6 6-6" />
    </StrokeSvg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z" />
    </StrokeSvg>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </StrokeSvg>
  );
}

export function TeamIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c.4-3.3 2.9-5.5 6-5.5s5.6 2.2 6 5.5" />
      <path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.3c1.9.7 3.2 2.6 3.5 5.2" />
    </StrokeSvg>
  );
}

export function ColumnsIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M9.5 4v16M15 4v16" />
    </StrokeSvg>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4 9.4" />
      <path d="M4 4.5v4.9h4.9M12 8v4l2.8 1.8" />
    </StrokeSvg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
    </StrokeSvg>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M4 20h16M7 16v-4M12 16V8M17 16V5" />
    </StrokeSvg>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </StrokeSvg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15V15h-6v5.5H5.5A1.5 1.5 0 0 1 4 19z" />
    </StrokeSvg>
  );
}

export function CheckSquareIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </StrokeSvg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
    </StrokeSvg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <StrokeSvg {...props}>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </StrokeSvg>
  );
}

export function GitHubIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    </Svg>
  );
}
