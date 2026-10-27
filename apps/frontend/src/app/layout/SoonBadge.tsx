/** Visible "Soon" marker for approved App Shell slots; pair it with screen-reader text. */
export function SoonBadge() {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full bg-app px-1.5 py-0.5 text-[11px] font-medium text-muted"
    >
      Soon
    </span>
  );
}
