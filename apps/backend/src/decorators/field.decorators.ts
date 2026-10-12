import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  SafeNumberQuery,
  StrictBoolean,
  ToLowerCase,
  Trim,
} from './transform.decorators';

interface FieldOptions {
  each?: boolean;
  nullable?: boolean;
  description?: string;
  example?: unknown;
}

interface StringOptions extends FieldOptions {
  minLength?: number;
  maxLength?: number;
  trim?: boolean;
}

interface NumberOptions extends FieldOptions {
  integer?: boolean;
  min?: number;
  max?: number;
}

function presence(
  options: FieldOptions,
  optional: boolean,
): PropertyDecorator[] {
  if (optional) {
    return [
      ValidateIf(
        (_object: unknown, value: unknown) =>
          value !== undefined && (value !== null || !options.nullable),
      ),
    ];
  }
  return options.nullable
    ? [
        ValidateIf((_object: unknown, value: unknown) => value !== null),
        IsDefined(),
      ]
    : [IsDefined()];
}

function property(
  type: unknown,
  options: FieldOptions,
  optional: boolean,
): PropertyDecorator {
  return ApiProperty({
    type: type as never,
    required: !optional,
    nullable: options.nullable ?? false,
    isArray: options.each ?? false,
    description: options.description,
    example: options.example,
  });
}

function array(options: FieldOptions): PropertyDecorator[] {
  return options.each ? [IsArray()] : [];
}

function stringField(
  options: StringOptions,
  optional: boolean,
): PropertyDecorator {
  return applyDecorators(
    ...presence(options, optional),
    ...array(options),
    ...(options.trim ? [Trim()] : []),
    IsString({ each: options.each }),
    MinLength(options.minLength ?? 1, { each: options.each }),
    ...(options.maxLength === undefined
      ? []
      : [MaxLength(options.maxLength, { each: options.each })]),
    property(String, options, optional),
  );
}

export const StringField = (options: StringOptions = {}): PropertyDecorator =>
  stringField(options, false);
export const StringFieldOptional = (
  options: StringOptions = {},
): PropertyDecorator => stringField(options, true);

function numberField(
  options: NumberOptions,
  optional: boolean,
): PropertyDecorator {
  return applyDecorators(
    ...presence(options, optional),
    ...array(options),
    SafeNumberQuery(options.integer),
    options.integer
      ? IsInt({ each: options.each })
      : IsNumber(
          { allowNaN: false, allowInfinity: false },
          { each: options.each },
        ),
    Max(Number.MAX_SAFE_INTEGER, { each: options.each }),
    Min(Number.MIN_SAFE_INTEGER, { each: options.each }),
    ...(options.min === undefined
      ? []
      : [Min(options.min, { each: options.each })]),
    ...(options.max === undefined
      ? []
      : [Max(options.max, { each: options.each })]),
    property(Number, options, optional),
  );
}

export const NumberField = (options: NumberOptions = {}): PropertyDecorator =>
  numberField(options, false);
export const NumberFieldOptional = (
  options: NumberOptions = {},
): PropertyDecorator => numberField(options, true);

function booleanField(
  options: FieldOptions,
  optional: boolean,
): PropertyDecorator {
  return applyDecorators(
    ...presence(options, optional),
    ...array(options),
    StrictBoolean(),
    IsBoolean({ each: options.each }),
    property(Boolean, options, optional),
  );
}

export const BooleanField = (options: FieldOptions = {}): PropertyDecorator =>
  booleanField(options, false);
export const BooleanFieldOptional = (
  options: FieldOptions = {},
): PropertyDecorator => booleanField(options, true);

function emailField(
  options: StringOptions,
  optional: boolean,
): PropertyDecorator {
  return applyDecorators(
    stringField(options, optional),
    ToLowerCase(),
    IsEmail({}, { each: options.each }),
    property(String, options, optional),
  );
}

export const EmailField = (options: StringOptions = {}): PropertyDecorator =>
  emailField(options, false);
export const EmailFieldOptional = (
  options: StringOptions = {},
): PropertyDecorator => emailField(options, true);

function uuidField(
  options: FieldOptions,
  optional: boolean,
): PropertyDecorator {
  return applyDecorators(
    ...presence(options, optional),
    ...array(options),
    IsUUID('4', { each: options.each }),
    ApiProperty({
      type: String,
      format: 'uuid',
      required: !optional,
      nullable: options.nullable ?? false,
      isArray: options.each ?? false,
      description: options.description,
      example: options.example,
    }),
  );
}

export const UUIDField = (options: FieldOptions = {}): PropertyDecorator =>
  uuidField(options, false);
export const UUIDFieldOptional = (
  options: FieldOptions = {},
): PropertyDecorator => uuidField(options, true);

function enumField<T extends object>(
  values: T,
  options: FieldOptions & { enumName?: string },
  optional: boolean,
): PropertyDecorator {
  return applyDecorators(
    ...presence(options, optional),
    ...array(options),
    IsEnum(values, { each: options.each }),
    ApiProperty({
      enum: values,
      enumName: options.enumName,
      required: !optional,
      nullable: options.nullable ?? false,
      isArray: options.each ?? false,
      description: options.description,
      example: options.example,
    }),
  );
}

export const EnumField = <T extends object>(
  values: T,
  options: FieldOptions & { enumName?: string } = {},
): PropertyDecorator => enumField(values, options, false);
export const EnumFieldOptional = <T extends object>(
  values: T,
  options: FieldOptions & { enumName?: string } = {},
): PropertyDecorator => enumField(values, options, true);

function dateField(
  options: FieldOptions,
  optional: boolean,
): PropertyDecorator {
  return applyDecorators(
    ...presence(options, optional),
    ...array(options),
    IsISO8601({ strict: true }, { each: options.each }),
    Matches(/(?:Z|[+-]\d{2}:\d{2})$/, {
      each: options.each,
      message: 'Date must include a timezone',
    }),
    ApiProperty({
      type: String,
      format: 'date-time',
      required: !optional,
      nullable: options.nullable ?? false,
      isArray: options.each ?? false,
      description: options.description,
      example: options.example,
    }),
  );
}

export const DateField = (options: FieldOptions = {}): PropertyDecorator =>
  dateField(options, false);
export const DateFieldOptional = (
  options: FieldOptions = {},
): PropertyDecorator => dateField(options, true);

function classField<T extends object>(
  type: () => new (...args: never[]) => T,
  options: FieldOptions,
  optional: boolean,
): PropertyDecorator {
  return applyDecorators(
    ...presence(options, optional),
    ...array(options),
    Type(type),
    IsObject({ each: options.each }),
    ValidateNested({ each: options.each }),
    ApiProperty({
      type,
      required: !optional,
      nullable: options.nullable ?? false,
      isArray: options.each ?? false,
      description: options.description,
      example: options.example,
    }),
  );
}

export const ClassField = <T extends object>(
  type: () => new (...args: never[]) => T,
  options: FieldOptions = {},
): PropertyDecorator => classField(type, options, false);
export const ClassFieldOptional = <T extends object>(
  type: () => new (...args: never[]) => T,
  options: FieldOptions = {},
): PropertyDecorator => classField(type, options, true);
