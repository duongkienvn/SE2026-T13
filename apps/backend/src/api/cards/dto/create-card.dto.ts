import {
  DateFieldOptional,
  StringField,
  StringFieldOptional,
  UUIDField,
} from '../../../decorators/field.decorators';

export class CreateCardDto {
  @UUIDField()
  columnId!: string;

  @StringField({ trim: true, minLength: 1, maxLength: 120 })
  title!: string;

  @StringFieldOptional({ nullable: true, minLength: 0, maxLength: 2000 })
  description?: string | null;

  @DateFieldOptional({ nullable: true })
  dueDate?: string | null;
}
