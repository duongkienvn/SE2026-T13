import { UUIDField } from '../../../decorators/field.decorators';

export class MoveCardDto {
  @UUIDField()
  toColumnId!: string;

  @UUIDField({
    nullable: true,
    description:
      'Insert before this active card; null appends to the destination column',
  })
  beforeCardId!: string | null;
}
