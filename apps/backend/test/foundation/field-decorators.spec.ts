import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsDefined, IsString, validateSync } from 'class-validator';
import {
  BooleanField,
  BooleanFieldOptional,
  ClassField,
  ClassFieldOptional,
  DateField,
  DateFieldOptional,
  EmailField,
  EmailFieldOptional,
  EnumField,
  EnumFieldOptional,
  NumberField,
  NumberFieldOptional,
  StringField,
  StringFieldOptional,
  UUIDField,
  UUIDFieldOptional,
} from '../../src/decorators/field.decorators';
import {
  SafeNumberQuery,
  StrictBoolean,
  ToLowerCase,
  ToUpperCase,
  Trim,
} from '../../src/decorators/transform.decorators';
import { IsNullable } from '../../src/decorators/validators/is-nullable.decorator';

const id = 'a15a498e-a94e-4d3e-bf18-46a05ddba0de';
enum Role {
  OWNER = 'OWNER',
  MEMBER = 'MEMBER',
}

class ChildDto {
  @StringField({ minLength: 2 })
  name!: string;
}

class FieldsDto {
  @StringField({ trim: true, minLength: 2, maxLength: 8 })
  title!: string;
  @StringFieldOptional({ nullable: true })
  subtitle?: string | null;
  @NumberField({ integer: true, min: 0, max: 10 })
  count!: number;
  @NumberFieldOptional({ integer: true })
  optionalCount?: number;
  @BooleanField()
  enabled!: boolean;
  @BooleanFieldOptional()
  optionalEnabled?: boolean;
  @EmailField({ trim: true })
  email!: string;
  @EmailFieldOptional()
  optionalEmail?: string;
  @UUIDField()
  userId!: string;
  @UUIDFieldOptional()
  optionalId?: string;
  @EnumField(Role)
  role!: Role;
  @EnumFieldOptional(Role)
  optionalRole?: Role;
  @DateField()
  occurredAt!: string;
  @DateFieldOptional()
  optionalDate?: string;
  @ClassField(() => ChildDto)
  child!: ChildDto;
  @ClassFieldOptional(() => ChildDto)
  optionalChild?: ChildDto;
  @StringField({ each: true })
  tags!: string[];
}

function validInput() {
  return {
    title: ' Board ',
    count: '0',
    enabled: 'false',
    email: ' TEST@EXAMPLE.COM ',
    userId: id,
    role: 'OWNER',
    occurredAt: '2026-10-12T12:34:56+07:00',
    child: { name: 'ok' },
    tags: ['a', 'b'],
  };
}

function errors(input: object): string[] {
  return validateSync(plainToInstance(FieldsDto, input)).map(
    (error) => error.property,
  );
}

describe('reusable DTO fields', () => {
  it('validates and transforms all required field groups', () => {
    const dto = plainToInstance(FieldsDto, validInput());
    expect(validateSync(dto)).toEqual([]);
    expect(dto).toMatchObject({
      title: 'Board',
      count: 0,
      enabled: false,
      email: 'test@example.com',
    });
    expect(dto.occurredAt).toBe('2026-10-12T12:34:56+07:00');
    expect(dto.child).toBeInstanceOf(ChildDto);
  });

  it('distinguishes undefined, null, false, zero, and invalid conversions', () => {
    expect(errors({ ...validInput(), subtitle: null })).toEqual([]);
    expect(errors({ ...validInput(), optionalEnabled: null })).toContain(
      'optionalEnabled',
    );
    expect(
      errors({ ...validInput(), optionalCount: '9007199254740993' }),
    ).toContain('optionalCount');
    expect(errors({ ...validInput(), count: 9007199254740992 })).toContain(
      'count',
    );
    expect(errors({ ...validInput(), optionalCount: 'Infinity' })).toContain(
      'optionalCount',
    );
    expect(errors({ ...validInput(), enabled: 'yes' })).toContain('enabled');
    expect(errors({ ...validInput(), count: '1e2' })).toContain('count');
    expect(errors({ ...validInput(), count: 11 })).toContain('count');
    expect(errors({ ...validInput(), title: 'a' })).toContain('title');
    expect(errors({ ...validInput(), title: ['valid'] })).toContain('title');
  });

  it('checks enum, UUID, email, date, arrays, and nested DTOs', () => {
    expect(errors({ ...validInput(), role: 'ADMIN' })).toContain('role');
    expect(errors({ ...validInput(), userId: 'bad' })).toContain('userId');
    expect(errors({ ...validInput(), email: 'bad' })).toContain('email');
    expect(
      errors({ ...validInput(), occurredAt: '2026-10-12T12:34:56' }),
    ).toContain('occurredAt');
    expect(errors({ ...validInput(), tags: ['ok', 42] })).toContain('tags');
    expect(errors({ ...validInput(), tags: 'ok' })).toContain('tags');
    const invalidChild = validateSync(
      plainToInstance(FieldsDto, { ...validInput(), child: { name: 'a' } }),
    );
    expect(
      invalidChild.find((error) => error.property === 'child')?.children?.[0]
        ?.property,
    ).toBe('name');
  });

  it('accepts valid optional fields and validates present values', () => {
    const dto = plainToInstance(FieldsDto, {
      ...validInput(),
      optionalCount: '2',
      optionalEnabled: 'true',
      optionalEmail: 'A@EXAMPLE.COM',
      optionalId: id,
      optionalRole: 'MEMBER',
      optionalDate: '2026-10-12T12:34:56Z',
      optionalChild: { name: 'yes' },
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.optionalCount).toBe(2);
    expect(dto.optionalEnabled).toBe(true);
    expect(dto.optionalChild).toBeInstanceOf(ChildDto);
  });
});

class TransformDto {
  @Trim() text!: unknown;
  @ToLowerCase() lower!: unknown;
  @ToUpperCase() upper!: unknown;
  @StrictBoolean() bool!: unknown;
  @SafeNumberQuery(true) int!: unknown;
  @SafeNumberQuery() float!: unknown;
}

class NullableDto {
  @IsNullable()
  @IsDefined()
  @IsString()
  value!: string | null;
}

describe('transform and nullable helpers', () => {
  it('leaves wrong types alone instead of throwing or changing their meaning', () => {
    const dto = plainToInstance(TransformDto, {
      text: 0,
      lower: false,
      upper: null,
      bool: 'yes',
      int: '9007199254740993',
      float: '9007199254740993',
    });
    expect(dto).toMatchObject({
      text: 0,
      lower: false,
      upper: null,
      bool: 'yes',
      int: '9007199254740993',
      float: '9007199254740993',
    });
    const valid = plainToInstance(TransformDto, {
      text: ' x ',
      lower: 'A',
      upper: 'a',
      bool: 'false',
      int: '0',
      float: '0.5',
    });
    expect(valid).toMatchObject({
      text: 'x',
      lower: 'a',
      upper: 'A',
      bool: false,
      int: 0,
      float: 0.5,
    });
  });

  it('allows explicit null while still rejecting undefined', () => {
    expect(validateSync(plainToInstance(NullableDto, { value: null }))).toEqual(
      [],
    );
    expect(validateSync(plainToInstance(NullableDto, {}))).toHaveLength(1);
  });
});
