import { ImportCardRowDto } from './dto/import-cards.dto';

export interface AcceptedImportRow {
  index: number;
  row: ImportCardRowDto;
}

export interface RejectedImportRow {
  index: number;
  details: string[];
}

/** Test-first seam: behaviour is specified in test/cards/cards-import.spec.ts. */
export async function classifyImportRows(
  _items: unknown[],
): Promise<{ accepted: AcceptedImportRow[]; rejected: RejectedImportRow[] }> {
  return { accepted: [], rejected: [] };
}
