import type { ComponentType } from 'react';
import { Alert } from '../../../components/Alert';
import { BrandLogo } from '../../../components/Brand';
import { Button } from '../../../components/Button';
import {
  MonitorIcon,
  MoonIcon,
  SunIcon,
  type IconProps,
} from '../../../components/icons';
import { PageHeader } from '../../../components/PageHeader';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { usePreferences, useUpdatePreferences } from '../hooks';
import { DARK_QUERY } from '../theme';
import type { ThemePreference } from '../types';

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: ComponentType<IconProps>;
}[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'Match System', icon: MonitorIcon },
];

const cardClass =
  'max-w-4xl rounded-xl border border-line bg-surface p-5 shadow-card md:p-6';

export function AppearancePage() {
  usePageTitle('Appearance');
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const systemDark = useMediaQuery(DARK_QUERY);
  // Shows the pending choice at once; the hook puts it back if the save fails.
  const theme = preferences.data?.theme;

  const choose = (value: ThemePreference) => {
    if (value === theme) return;
    update.save({ theme: value });
  };

  return (
    <>
      <PageHeader
        title="Appearance"
        description="Customize how Kanvexa looks and feels."
      />
      <section aria-labelledby="theme-heading" className={`mt-6 ${cardClass}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="theme-heading" className="text-lg font-semibold text-ink">
              Theme
            </h2>
            <p className="mt-1 text-sm text-muted">
              Choose your preferred theme. It is saved to your account.
            </p>
          </div>
          {/* Honest status: "Saved" only after the server confirms. */}
          <p role="status" className="text-sm text-muted">
            {update.isPending ? 'Saving…' : update.isSuccess ? 'Saved' : ''}
          </p>
        </div>

        {preferences.isPending && (
          <p className="mt-4 text-sm text-muted">Loading your theme…</p>
        )}
        {preferences.isError && (
          <div className="mt-4 space-y-3">
            <Alert variant="error">Could not load your theme.</Alert>
            <Button
              variant="secondary"
              onClick={() => void preferences.refetch()}
            >
              Try again
            </Button>
          </div>
        )}

        {theme && (
          <>
            {update.isError && (
              <div className="mt-4">
                <Alert variant="error">
                  Could not save your theme, so the previous one is back. Check
                  your connection and choose again.
                </Alert>
              </div>
            )}
            <fieldset className="mt-4">
              <legend className="sr-only">Theme</legend>
              <div className="grid max-w-xl grid-cols-3 gap-3">
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                  const selected = theme === value;
                  return (
                    <label
                      key={value}
                      className={`relative flex min-h-20 short:min-h-16 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                        selected
                          ? 'border-primary bg-primary-soft text-primary'
                          : 'border-line text-ink hover:bg-app'
                      }`}
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={value}
                        checked={selected}
                        onChange={() => choose(value)}
                        className="sr-only"
                      />
                      {selected && (
                        <span
                          aria-hidden="true"
                          className="absolute top-2 left-2 size-2 rounded-full bg-primary"
                        />
                      )}
                      <Icon className="size-6" />
                      {label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {theme === 'system' && (
              <p className="mt-3 text-sm text-muted">
                Following your device, currently{' '}
                <span className="font-medium text-ink">
                  {systemDark ? 'dark' : 'light'}
                </span>
                .
              </p>
            )}
            <ThemePreview />
          </>
        )}
      </section>
    </>
  );
}

/** Token-styled sketch of the app in the active theme; no real or sample data. */
function ThemePreview() {
  return (
    <figure className="mt-4 max-w-xl">
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-line bg-app"
      >
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
          <BrandLogo decorative className="size-5" />
          <span className="text-sm font-semibold text-ink">Kanvexa</span>
          <span className="ml-auto h-2 w-16 rounded-full bg-line" />
        </div>
        <div className="flex gap-3 p-3">
          {[0, 1].map((column) => (
            <div
              key={column}
              className="flex-1 space-y-2 rounded-lg bg-surface p-3 shadow-card"
            >
              <span className="block h-2 w-1/2 rounded-full bg-muted/30" />
              <span className="block h-6 rounded-md border border-line bg-app" />
              <span
                className={`block h-6 rounded-md border ${
                  column === 0
                    ? 'border-primary/40 bg-primary-soft'
                    : 'border-line bg-app'
                }`}
              />
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted">
        Preview of Kanvexa in the selected theme.
      </figcaption>
    </figure>
  );
}
