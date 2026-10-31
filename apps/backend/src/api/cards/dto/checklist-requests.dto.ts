import {
  BooleanFieldOptional,
  StringField,
  StringFieldOptional,
  UUIDField,
} from '../../../decorators/field.decorators';

export class ChecklistTitleDto {
  @StringField({ trim: true, minLength: 1, maxLength: 120 }) title!: string;
}
export class CreateChecklistItemDto {
  @StringField({ trim: true, minLength: 1, maxLength: 255 }) text!: string;
}
export class UpdateChecklistItemDto {
  @StringFieldOptional({ trim: true, minLength: 1, maxLength: 255 })
  text?: string;
  @BooleanFieldOptional() isChecked?: boolean;
}
export class MoveChecklistDto {
  @UUIDField({
    nullable: true,
    description: 'Insert before a checklist in this Card; null appends',
  })
  beforeChecklistId!: string | null;
}
export class MoveChecklistItemDto {
  @UUIDField({
    nullable: true,
    description: 'Insert before an item in this checklist; null appends',
  })
  beforeItemId!: string | null;
}
/** No query parameters are supported; unknown fields are rejected. */
export class ChecklistReadQueryDto {}
