/** Persisted lifecycle. Only verified ACTIVE metadata is publicly listable. */
export const AttachmentKind = { URL: 'URL', FILE: 'FILE' } as const;
export type AttachmentKind =
  (typeof AttachmentKind)[keyof typeof AttachmentKind];
export const AttachmentState = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  REMOVED: 'REMOVED',
} as const;
export type AttachmentState =
  (typeof AttachmentState)[keyof typeof AttachmentState];

/** Keys, intent details, provider data and access grants are never metadata. */
export interface CardAttachmentMetadata {
  readonly id: string;
  readonly boardId: string;
  readonly cardId: string;
  readonly uploaderId: string;
  readonly kind: AttachmentKind;
  readonly state: 'ACTIVE';
  readonly displayName: string;
  readonly url: string | null;
  readonly originalFilename: string | null;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface CreateUrlAttachment {
  readonly kind: 'URL';
  readonly url: string;
  readonly displayName?: string;
}
export interface UpdateUrlAttachment {
  readonly expectedRevision: number;
  readonly url?: string;
  readonly displayName?: string;
}

export interface CreateAttachmentUpload {
  readonly filename: string;
  readonly contentType: string;
  readonly fileSize: number;
  readonly displayName?: string;
}
/** Uploader-only short-lived instructions; never cache, log or broadcast grants. */
export interface CardAttachmentUploadIntent {
  readonly uploadId: string;
  readonly state: 'PENDING' | 'ACTIVE';
  readonly expiresAt: string;
  readonly upload: {
    readonly kind: 'memory' | 's3';
    readonly expiresAt: string;
    readonly url: string;
    readonly fields: Readonly<Record<string, string>>;
  } | null;
}

/** V1 reuses card:updated IDs; consumers refetch the affected Card's attachments. */
