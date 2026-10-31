import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import {
  StringField,
  StringFieldOptional,
  UUIDField,
} from '../../../decorators/field.decorators';
import { ToUpperCase } from '../../../decorators/transform.decorators';

function LabelColor(optional = false): PropertyDecorator {
  return applyDecorators(
    optional
      ? StringFieldOptional({ trim: true, minLength: 7, maxLength: 7 })
      : StringField({ trim: true, minLength: 7, maxLength: 7 }),
    ToUpperCase(),
    Matches(/^#[0-9A-F]{6}$/),
    ApiProperty({
      type: String,
      required: !optional,
      pattern: '^#[0-9A-Fa-f]{6}$',
      example: '#615CF7',
      description:
        'Six-digit hex; trimmed and normalized to uppercase. Null is rejected.',
    }),
  );
}
export class CreateLabelDto {
  @StringField({ trim: true, minLength: 1, maxLength: 120 }) name!: string;
  @LabelColor() color!: string;
}
export class UpdateLabelDto {
  @StringFieldOptional({ trim: true, minLength: 1, maxLength: 120 })
  name?: string;
  @LabelColor(true) color?: string;
}
export class AssignLabelDto {
  @UUIDField() labelId!: string;
}
export class CardLabelsQueryDto {}
