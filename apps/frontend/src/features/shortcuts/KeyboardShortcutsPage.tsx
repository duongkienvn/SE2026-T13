import {
  ColumnsIcon,
  SettingsIcon,
  ArrowRightIcon,
  KeyboardIcon,
} from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { usePageTitle } from '../../hooks/usePageTitle';
import { modifierLabel, shortcutGroups } from './registry';

export function KeyboardShortcutsPage() {
  usePageTitle('Keyboard shortcuts');
  const modifier = modifierLabel(
    typeof navigator === 'undefined' ? '' : navigator.platform,
  );
  const icons = [ArrowRightIcon, ColumnsIcon, SettingsIcon];
  return (
    <div>
      <div className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <KeyboardIcon className="size-7" />
        </span>
        <PageHeader
          title="Keyboard shortcuts"
          description="Work faster on Kanvexa with keyboard shortcuts."
        />
      </div>
      <div className="mt-7 space-y-3">
        {shortcutGroups.map((group, index) => {
          const Icon = icons[index];
          return (
            <section
              key={group.title}
              className="rounded-xl border border-line bg-surface p-4 sm:p-5"
              aria-labelledby={`shortcuts-${index}`}
            >
              <div className="flex items-center gap-3">
                <Icon className="size-5 shrink-0 text-primary" />
                <h2
                  id={`shortcuts-${index}`}
                  className="text-lg font-semibold text-ink"
                >
                  {group.title}
                </h2>
              </div>
              <dl className="mt-3 sm:ml-8">
                {group.rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2 last:border-0"
                  >
                    <dt className="min-w-0 text-sm text-ink">
                      {row.label}
                      <span className="block text-xs text-muted">
                        {row.scope}
                      </span>
                    </dt>
                    <dd
                      className="flex items-center gap-1"
                      aria-label={row.keys
                        .map((key) =>
                          key === 'Mod'
                            ? modifier === '⌘'
                              ? 'Command'
                              : modifier
                            : key,
                        )
                        .join(
                          row.keys[0] === 'G'
                            ? ' then '
                            : row.keys[0] === 'Mod'
                              ? ' plus '
                              : ' ',
                        )}
                    >
                      {row.keys.map((key, i) =>
                        key === '/' ? (
                          <span
                            key={i}
                            aria-hidden="true"
                            className="text-muted"
                          >
                            /
                          </span>
                        ) : (
                          <kbd
                            key={i}
                            className="min-w-8 rounded-md bg-app px-2 py-1 text-center text-xs font-semibold text-ink"
                          >
                            {key === 'Mod' ? modifier : key}
                          </kbd>
                        ),
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
      <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        Shortcuts do not run while you type or use an overlay. J and K move
        focus only; Enter opens the focused card.
      </p>
    </div>
  );
}
