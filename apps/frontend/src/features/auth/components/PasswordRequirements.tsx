import { CheckCircleIcon } from '../../../components/icons';
import {
  newPasswordRequirements,
  passwordLength,
  PASSWORD_MAX_LENGTH,
} from '../validation';

export function PasswordRequirements({
  id,
  password,
}: {
  id: string;
  password: string;
}) {
  const requirements = newPasswordRequirements(password);
  const length = passwordLength(password);
  const tooLong = length > PASSWORD_MAX_LENGTH;
  const met = requirements.filter((requirement) => requirement.met).length;

  return (
    <div id={id} className="space-y-1 text-xs">
      <ul
        aria-label="Password requirements"
        className="grid grid-cols-1 gap-x-3 gap-y-1 min-[360px]:grid-cols-2"
      >
        {requirements.map((requirement) => (
          <li
            key={requirement.label}
            className={`flex items-center gap-1.5 ${requirement.met ? 'text-success' : 'text-muted'}`}
          >
            {requirement.met ? (
              <CheckCircleIcon className="size-3.5 shrink-0" />
            ) : (
              <span
                aria-hidden="true"
                className="grid size-3.5 shrink-0 place-items-center"
              >
                ○
              </span>
            )}
            <span>
              <span className="sr-only">
                {requirement.met ? 'Met: ' : 'Not met: '}
              </span>
              {requirement.label}
            </span>
          </li>
        ))}
      </ul>
      <p
        className={`flex justify-between gap-2 ${tooLong ? 'text-danger' : 'text-muted'}`}
      >
        <span>Maximum {PASSWORD_MAX_LENGTH} characters</span>
        <span>
          {length}/{PASSWORD_MAX_LENGTH}
        </span>
      </p>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {met} of 4 password requirements met.
        {tooLong ? ' Password exceeds 128 characters.' : ''}
      </p>
    </div>
  );
}
