import { Transform } from 'class-transformer';

function mapStrings(
  value: unknown,
  transform: (input: string) => string,
): unknown {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value))
    return value.map((item) =>
      typeof item === 'string' ? transform(item) : item,
    );
  return value;
}

export const Trim = (): PropertyDecorator =>
  Transform(
    ({ value }: { value: unknown }) =>
      mapStrings(value, (input) => input.trim()),
    { toClassOnly: true },
  );

export const ToLowerCase = (): PropertyDecorator =>
  Transform(
    ({ value }: { value: unknown }) =>
      mapStrings(value, (input) => input.toLowerCase()),
    { toClassOnly: true },
  );

export const ToUpperCase = (): PropertyDecorator =>
  Transform(
    ({ value }: { value: unknown }) =>
      mapStrings(value, (input) => input.toUpperCase()),
    { toClassOnly: true },
  );

export const StrictBoolean = (): PropertyDecorator =>
  Transform(
    ({ value }: { value: unknown }) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    },
    { toClassOnly: true },
  );

export const SafeNumberQuery = (integer = false): PropertyDecorator =>
  Transform(
    ({ value }: { value: unknown }) => {
      if (
        typeof value !== 'string' ||
        !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
      )
        return value;
      const parsed = Number(value);
      if (
        !Number.isFinite(parsed) ||
        Math.abs(parsed) > Number.MAX_SAFE_INTEGER ||
        (integer && !Number.isSafeInteger(parsed))
      )
        return value;
      return parsed;
    },
    { toClassOnly: true },
  );
