import { ClassConstructor, plainToInstance } from 'class-transformer';

/** Response DTOs must use @Expose for every public field and @Type for nested DTOs. */
export function toResponseDto<T extends object>(
  type: ClassConstructor<T>,
  value: unknown,
): T {
  return plainToInstance(type, value, {
    excludeExtraneousValues: true,
    enableImplicitConversion: false,
  });
}
