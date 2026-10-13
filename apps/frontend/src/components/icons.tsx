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
