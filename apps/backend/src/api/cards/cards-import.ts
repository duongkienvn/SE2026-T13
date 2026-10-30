import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../config/validation';
import { ImportCardRowDto } from './dto/import-cards.dto';

export interface AcceptedImportRow {
  index: number;
  row: ImportCardRowDto;
}

export interface RejectedImportRow {
  index: number;
  details: string[];
}

// Same pipe options as the HTTP layer, so a row obeys exactly the CreateCardDto rules.
const rowPipe = createValidationPipe();

async function rowErrors(
  item: unknown,
): Promise<{ row: ImportCardRowDto | null; details: string[] }> {
  if (typeof item !== 'object' || item === null || Array.isArray(item))
    return { row: null, details: ['row: must be an object'] };
  try {
    const row = (await rowPipe.transform(item, {
      type: 'body',
      metatype: ImportCardRowDto,
    })) as ImportCardRowDto;
    return { row, details: [] };
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const { details } = error.getResponse() as { details?: string[] };
    return { row: null, details: details ?? ['row: invalid'] };
  }
}

/** RECEIVED -> ACCEPTED | REJECTED; only ACCEPTED rows may become cards. */
export async function classifyImportRows(
  items: unknown[],
): Promise<{ accepted: AcceptedImportRow[]; rejected: RejectedImportRow[] }> {
  const accepted: AcceptedImportRow[] = [];
  const rejected: RejectedImportRow[] = [];
  for (const [index, item] of items.entries()) {
    const { row, details } = await rowErrors(item);
    const isValid = row !== null && details.length === 0;
    if (isValid) accepted.push({ index, row: row as ImportCardRowDto });
    else rejected.push({ index, details });
  }
  return { accepted, rejected };
}
