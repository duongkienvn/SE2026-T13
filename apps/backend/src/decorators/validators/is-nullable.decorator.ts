import { ValidateIf } from 'class-validator';

/** Skip other validators only for an explicit null value. Undefined remains invalid when required. */
export const IsNullable = (): PropertyDecorator =>
  ValidateIf((_object: unknown, value: unknown) => value !== null);
