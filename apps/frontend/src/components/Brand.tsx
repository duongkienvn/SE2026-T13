/** Official transparent artwork; shared as one cacheable file, never recolored. */
export function BrandLogo({
  decorative = false,
  className = '',
}: {
  decorative?: boolean;
  className?: string;
}) {
  return (
    <img
      src="/branding/kanvexa-logo-v1.png"
      alt={decorative ? '' : 'Kanvexa'}
      width={1024}
      height={1024}
      decoding="async"
      draggable={false}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}

/** The wordmark inherits its surrounding text color on light or dark surfaces. */
export function Brand({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizes = {
    sm: { layout: 'gap-1 text-lg md:text-xl', logo: 'size-9' },
    md: { layout: 'gap-2 text-[26px]', logo: 'size-12' },
    lg: { layout: 'gap-2.5 text-[32px]', logo: 'size-16' },
  }[size];

  return (
    <div
      className={`inline-flex shrink-0 items-center font-semibold tracking-tight ${sizes.layout} ${className}`}
    >
      <BrandLogo decorative className={sizes.logo} />
      <span>Kanvexa</span>
    </div>
  );
}
