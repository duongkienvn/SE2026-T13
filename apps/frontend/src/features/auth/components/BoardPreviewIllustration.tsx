import { LogoIcon } from '../../../components/icons';

/*
 * Decorative product preview for the login panel. It deliberately uses
 * abstract placeholder bars instead of fake board, card or user data.
 */

const columns = [
  {
    cards: [
      { chip: 'bg-danger/20', lines: 2 },
      { chip: 'bg-primary/25', lines: 1 },
    ],
  },
  {
    cards: [
      { chip: 'bg-success/20', lines: 2 },
      { chip: 'bg-danger/20', lines: 1 },
    ],
  },
];

export function BoardPreviewIllustration({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={className}>
      <div className="flex h-full overflow-hidden rounded-tl-2xl bg-surface/95 shadow-frame">
        <div className="w-12 shrink-0 border-r border-line">
          <div className="grid h-12 place-items-center bg-brand-soft text-white">
            <LogoIcon className="size-5" />
          </div>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="grid h-12 place-items-center">
              <span
                className={`size-4 rounded ${index === 3 ? 'bg-primary/60' : 'bg-muted/30'}`}
              />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-12 items-center gap-3 px-5">
            <span className="text-sm font-semibold text-brand">Kanban</span>
            <span className="h-6 w-28 rounded-md border border-line" />
          </div>
          <div className="mx-5 mt-2 h-3 w-24 rounded bg-muted/15" />
          <div className="mt-5 flex gap-4 px-5">
            {columns.map((column, columnIndex) => (
              <div
                key={columnIndex}
                className="w-[220px] shrink-0 rounded-lg bg-app p-3"
              >
                <div className="mb-3 h-3 w-20 rounded bg-muted/25" />
                <div className="space-y-3">
                  {column.cards.map((card, cardIndex) => (
                    <div
                      key={cardIndex}
                      className="rounded-md bg-surface p-3 shadow-card"
                    >
                      <span className={`block h-3 w-10 rounded ${card.chip}`} />
                      <span className="mt-3 block h-2.5 w-4/5 rounded bg-ink/15" />
                      {card.lines > 1 && (
                        <span className="mt-2 block h-2.5 w-3/5 rounded bg-ink/10" />
                      )}
                      <div className="mt-4 flex items-center justify-between">
                        <span className="h-2 w-12 rounded bg-muted/20" />
                        <span className="size-6 rounded-full bg-primary-soft" />
                      </div>
                    </div>
                  ))}
                  <div className="h-2.5 w-12 rounded bg-muted/20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
