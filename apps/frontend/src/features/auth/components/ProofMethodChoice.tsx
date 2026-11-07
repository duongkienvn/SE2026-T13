import { GoogleGIcon, LockIcon } from '../../../components/icons';
import type { LinkedProviders } from '../api';

export type ProofMethod = 'password' | 'google';

/** Methods the account can actually use for fresh reauthentication. */
export function availableProofMethods(
  providers: LinkedProviders,
): ProofMethod[] {
  const methods: ProofMethod[] = [];
  if (providers.hasPassword) methods.push('password');
  if (providers.googleLinked) methods.push('google');
  return methods;
}

const OPTIONS: Record<
  ProofMethod,
  { label: string; description: string; Icon: typeof LockIcon }
> = {
  password: {
    label: 'Password',
    description: 'Enter your current password.',
    Icon: LockIcon,
  },
  google: {
    label: 'Google account',
    description: 'Use your linked Google account.',
    Icon: GoogleGIcon,
  },
};

/**
 * Mutually exclusive Password / Google account tiles. Only linked methods are
 * offered, so a Google-only account never sees a password path.
 */
export function ProofMethodChoice({
  name,
  methods,
  value,
  onChange,
  disabled = false,
  legend = 'Verify your identity',
  hint = 'Choose one method to confirm that it’s really you.',
}: {
  name: string;
  methods: ProofMethod[];
  value: ProofMethod;
  onChange: (method: ProofMethod) => void;
  disabled?: boolean;
  legend?: string;
  hint?: string;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <div
        className={`mt-1.5 grid gap-2.5 ${methods.length > 1 ? 'sm:grid-cols-2' : ''}`}
      >
        {methods.map((method) => {
          const { label, description, Icon } = OPTIONS[method];
          const checked = value === method;
          return (
            <label
              key={method}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-1.5 transition-colors has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                checked
                  ? 'border-primary bg-primary-soft'
                  : 'border-line hover:bg-app'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={method}
                checked={checked}
                onChange={() => onChange(method)}
                className="size-4 shrink-0 accent-primary"
              />
              <Icon
                aria-hidden="true"
                className={`size-5 shrink-0 ${method === 'password' && checked ? 'text-primary' : 'text-muted'}`}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  {label}
                </span>
                <span className="block text-xs text-muted">{description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
