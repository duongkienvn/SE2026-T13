import { ClientErrorCode, isApiError } from '../../lib/api-client';

export interface FormErrorState<Field extends string> {
  formError?: string;
  fieldErrors: Partial<Record<Field, string>>;
}

const GENERIC_ERROR = 'Something went wrong on our side. Please try again.';

/**
 * The backend validation pipe sends details as "<path>: <message>", where the
 * class-validator message itself starts with the property name, e.g.
 * "displayName: displayName must be shorter than or equal to 80 characters".
 */
function parseValidationDetail(detail: string): {
  path?: string;
  message: string;
} {
  const match = /^([\w.[\]]+): (.+)$/.exec(detail);
  return match ? { path: match[1], message: match[2] } : { message: detail };
}

/**
 * Turns an API failure into user-facing form feedback. Never surfaces raw
 * server internals; unknown errors fall back to a generic message.
 */
export function toFormErrors<Field extends string>(
  error: unknown,
  fieldLabels: Record<Field, string>,
): FormErrorState<Field> {
  const fields = Object.keys(fieldLabels) as Field[];
  const hasField = (name: string): name is Field =>
    (fields as string[]).includes(name);
  if (!isApiError(error)) return { formError: GENERIC_ERROR, fieldErrors: {} };

  if (error.code === 'VALIDATION_FAILED') {
    const fieldErrors: Partial<Record<Field, string>> = {};
    const unmatched: string[] = [];
    for (const detail of error.details) {
      const { path, message } = parseValidationDetail(detail);
      const property = (path ?? message.split(' ')[0]).split('.')[0];
      if (hasField(property)) {
        // Show the form's label instead of the raw property name.
        fieldErrors[property] ??= message.startsWith(`${property} `)
          ? `${fieldLabels[property]}${message.slice(property.length)}`
          : capitalize(message);
      } else {
        unmatched.push(capitalize(message));
      }
    }
    const hasFieldErrors = Object.keys(fieldErrors).length > 0;
    return {
      formError:
        unmatched.length > 0
          ? unmatched.join(' ')
          : hasFieldErrors
            ? undefined
            : 'Please check the form and try again.',
      fieldErrors,
    };
  }

  // Match the documented codes and their generic HTTP equivalents
  // (e.g. a unique-index CONFLICT on registration).
  if (
    hasField('email') &&
    (error.code === 'EMAIL_ALREADY_EXISTS' || error.status === 409)
  ) {
    return {
      fieldErrors: {
        email: 'This email is already registered.',
      } as Partial<Record<Field, string>>,
    };
  }
  if (
    error.code === 'INVALID_CREDENTIALS' ||
    (error.status === 401 && hasField('password'))
  ) {
    return { formError: 'Incorrect email or password.', fieldErrors: {} };
  }
  if (error.code === 'TOO_MANY_REQUESTS' || error.status === 429) {
    return {
      formError: 'Too many attempts. Please wait a moment and try again.',
      fieldErrors: {},
    };
  }
  if (error.code === ClientErrorCode.NETWORK_ERROR) {
    return { formError: error.message, fieldErrors: {} };
  }
  return { formError: GENERIC_ERROR, fieldErrors: {} };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
