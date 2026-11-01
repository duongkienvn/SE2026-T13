import type { Label } from '../api';

/** Colors offered for new labels; stored labels may use any `#RRGGBB`. */
export const LABEL_COLORS = [
  { value: '#615CF7', name: 'Indigo' },
  { value: '#2563EB', name: 'Blue' },
  { value: '#0E7490', name: 'Teal' },
  { value: '#15803D', name: 'Green' },
  { value: '#CA8A04', name: 'Yellow' },
  { value: '#EA580C', name: 'Orange' },
  { value: '#DC2626', name: 'Red' },
  { value: '#DB2777', name: 'Pink' },
  { value: '#9333EA', name: 'Purple' },
  { value: '#475569', name: 'Slate' },
] as const;

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Dark or white text, whichever contrasts more with the label color. */
export function labelTextColor(color: string): string {
  if (!/^#[0-9A-F]{6}$/i.test(color)) return '#172038';
  const background = luminance(color);
  const onWhite = 1.05 / (background + 0.05);
  const onDark = (background + 0.05) / (luminance('#172038') + 0.05);
  return onWhite >= onDark ? '#FFFFFF' : '#172038';
}

/**
 * Read-only label chip: the name is always shown, so color is never the only
 * cue. Reusable by Board card previews (P3-13).
 */
export function LabelBadge({
  label,
  size = 'md',
}: {
  label: Pick<Label, 'name' | 'color'>;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      title={label.name}
      className={`inline-flex max-w-full min-w-0 items-center rounded-md font-medium ${
        size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-xs'
      }`}
      style={{
        backgroundColor: label.color,
        color: labelTextColor(label.color),
      }}
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** A card's labels as a list of badges. */
export function LabelBadges({
  labels,
  size,
}: {
  labels: Pick<Label, 'id' | 'name' | 'color'>[];
  size?: 'sm' | 'md';
}) {
  if (labels.length === 0) return null;
  return (
    <ul aria-label="Labels" className="flex min-w-0 flex-wrap gap-1.5">
      {labels.map((label) => (
        <li key={label.id} className="min-w-0 max-w-full">
          <LabelBadge label={label} size={size} />
        </li>
      ))}
    </ul>
  );
}
