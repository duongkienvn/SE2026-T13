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

export function LogoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="8" height="10" rx="1.5" />
      <rect x="13" y="3" width="8" height="6" rx="1.5" />
      <rect x="3" y="15" width="8" height="6" rx="1.5" />
      <rect x="13" y="11" width="8" height="10" rx="1.5" />
    </Svg>
  );
}

/** Four-square brand mark used on the authentication screens. */
export function BrandMarkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="9" height="9" rx="2" />
      <rect x="13" y="2" width="9" height="9" rx="2" />
      <rect x="2" y="13" width="9" height="9" rx="2" />
      <rect x="13" y="13" width="9" height="9" rx="2" />
    </Svg>
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
