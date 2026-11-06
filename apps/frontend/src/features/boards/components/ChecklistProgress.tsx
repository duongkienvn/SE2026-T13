export function ChecklistProgress({
  checked,
  total,
  label,
}: {
  checked: number;
  total: number;
  label: string;
}) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={checked}
      aria-valuemin={0}
      aria-valuemax={total || 1}
      className="block h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-muted/35"
    >
      <span
        className={`block h-full rounded-full ${total > 0 && checked === total ? 'bg-success' : 'bg-primary-solid'}`}
        style={{ width: `${total ? (checked / total) * 100 : 0}%` }}
      />
    </span>
  );
}
