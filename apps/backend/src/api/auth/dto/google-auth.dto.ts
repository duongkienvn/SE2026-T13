import { StringField } from '../../../decorators/field.decorators';

export class GoogleAuthDto {
  @StringField({
    minLength: 1,
    maxLength: 8192,
    description:
      'Google Identity Services ID token; never a Kanvexa Bearer token',
  })
  credential!: string;
}

export class GoogleLinkDto extends GoogleAuthDto {
  @StringField({
    minLength: 1,
    maxLength: 128,
    description: 'Current Kanvexa password for explicit reauthentication',
  })
  password!: string;
}
