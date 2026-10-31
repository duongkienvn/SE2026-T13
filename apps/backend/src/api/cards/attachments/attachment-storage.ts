import { Injectable } from '@nestjs/common';
import { ApplicationException } from '../../../exceptions/application.exception';

/** Internal only: grants and keys must never enter attachment metadata or events. */
export interface AttachmentUploadGrant {
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}
export interface AttachmentStoredObject {
  readonly body: AsyncIterable<Uint8Array>;
  readonly byteSize: number;
  /** Untrusted until P3-06 validates actual bounded bytes. */
  readonly contentType: string;
}
export interface AttachmentUploadReservation {
  readonly pendingKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly expiresAt: Date;
}
export interface VerifiedAttachmentWrite {
  readonly storageKey: string;
  readonly body: AsyncIterable<Uint8Array>;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly ifAbsent: true;
}

/** P3-06 must perform all storage/byte verification outside Board transactions. */
export abstract class AttachmentStorage {
  abstract readonly available: boolean;
  abstract createUploadGrant(
    reservation: AttachmentUploadReservation,
  ): Promise<AttachmentUploadGrant>;
  abstract read(
    key: string,
    maximumBytes: number,
  ): Promise<AttachmentStoredObject>;
  abstract writeVerified(input: VerifiedAttachmentWrite): Promise<void>;
  abstract delete(key: string): Promise<void>;
}
export function attachmentFilesUnavailable(): never {
  throw new ApplicationException(
    503,
    'ATTACHMENT_FILES_NOT_AVAILABLE',
    'File attachments are not available',
  );
}
@Injectable()
export class DisabledAttachmentStorage extends AttachmentStorage {
  readonly available = false;
  async createUploadGrant(): Promise<AttachmentUploadGrant> {
    return attachmentFilesUnavailable();
  }
  async read(): Promise<AttachmentStoredObject> {
    return attachmentFilesUnavailable();
  }
  async writeVerified(): Promise<void> {
    return attachmentFilesUnavailable();
  }
  async delete(): Promise<void> {
    return attachmentFilesUnavailable();
  }
}
