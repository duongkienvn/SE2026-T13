import { DATA_EXPORT_BYTE_LIMIT } from '@kanban/shared';
import { ApplicationException } from '../../exceptions/application.exception';

export function exportTooLarge(): ApplicationException {
  return new ApplicationException(
    413,
    'EXPORT_TOO_LARGE',
    'Export exceeds the download limit',
  );
}
/** Buffer the completed representation: errors can never publish a partial file. */
export class ExportBuffer {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  constructor(private readonly limit = DATA_EXPORT_BYTE_LIMIT) {}
  append(value: string): void {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (this.bytes + bytes > this.limit) throw exportTooLarge();
    this.bytes += bytes;
    this.chunks.push(Buffer.from(value, 'utf8'));
  }
  json(value: unknown): void {
    this.append(JSON.stringify(value));
  }
  finish(): Buffer {
    return Buffer.concat(this.chunks, this.bytes);
  }
}

/** Lower-bound accounting for temporary nested rows, without retaining a second copy. */
export class ExportSizeBudget {
  private bytes = 0;
  json(value: unknown): void {
    this.bytes += Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (this.bytes > DATA_EXPORT_BYTE_LIMIT) throw exportTooLarge();
  }
}
