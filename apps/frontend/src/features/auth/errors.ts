import { ClientErrorCode, isApiError } from '../../lib/api-client';

export interface FormErrorState<Field extends string> {
  formError?: string;
  fieldErrors: Partial<Record<Field, string>>;
}

const GENERIC_ERROR = 'Something went wrong on our side. Please try again.';

/**
 * Turns an API failure into user-facing form feedback. Never surfaces raw
 * server internals; unknown errors fall back to a generic message.
 */
export function toFormErrors<Field extends string>(
  error: unknown,
  fieldLabels: Record<Field, string>,
): FormErrorState<Field> {
  const fields = Object.keys(fieldLabels) as Field[];
  if (!isApiError(error)) return { formError: GENERIC_ERROR, fieldErrors: {} };

  switch (error.code) {
    case 'VALIDATION_FAILED': {
      const fieldErrors: Partial<Record<Field, string>> = {};
      const unmatched: string[] = [];
      for (const detail of error.details) {
        // class-validator messages start with the property name, e.g. "email must be an email".
        const field = fields.find((name) => detail.startsWith(`${name} `));
        if (field && !fieldErrors[field])
          fieldErrors[field] =
            `${fieldLabels[field]}${detail.slice(field.length)}`;
        else if (!field) unmatched.push(detail);
      }
      const hasFieldErrors = Object.keys(fieldErrors).length > 0;
      return {
        formError:
          unmatched.length > 0
            ? unmatched.map(capitalize).join(' ')
            : hasFieldErrors
              ? undefined
              : 'Please check the form and try again.',
        fieldErrors,
      };
    }
    case 'EMAIL_ALREADY_EXISTS':
      return {
        fieldErrors: {
          ['email' as Field]: 'This email is already registered.',
        } as Partial<Record<Field, string>>,
      };
    case 'INVALID_CREDENTIALS':
      return { formError: 'Incorrect email or password.', fieldErrors: {} };
    case 'TOO_MANY_REQUESTS':
      return {
        formError: 'Too many attempts. Please wait a moment and try again.',
        fieldErrors: {},
      };
    case ClientErrorCode.NETWORK_ERROR:
      return { formError: error.message, fieldErrors: {} };
    default:
      return { formError: GENERIC_ERROR, fieldErrors: {} };
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
