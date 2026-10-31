import type { EntityManager } from 'typeorm';
import { CardAttachment } from '../entities/card-attachment.entity';

/** Implemented provisional metadata abuse safeguard, NOT approved production file policy. */
export const ATTACHMENT_CARD_SLOT_LIMIT = 20;

/** Recommendations only. File routes remain unavailable regardless of these values. */
export const ATTACHMENT_FILE_POLICY_PROPOSAL = Object.freeze({
  approval: 'REQUIRES_OWNER_REVIEW' as const,
  maximumFileBytes: 10 * 1024 * 1024,
  maximumBoardFileBytes: 100 * 1024 * 1024,
  maximumCardAttachments: 20,
  pendingIntentMinutes: 15,
  allowedTypes: Object.freeze({
    'image/png': Object.freeze(['.png']),
    'image/jpeg': Object.freeze(['.jpg', '.jpeg']),
    'image/webp': Object.freeze(['.webp']),
    'application/pdf': Object.freeze(['.pdf']),
    'text/plain': Object.freeze(['.txt']),
  }),
  inlineTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
});

export interface AttachmentQuotaUsage {
  readonly cardSlots: bigint;
  readonly boardFileBytes: bigint;
}

/** Call under the Board lock. Expired PENDING rows reserve until transitioned. */
export async function attachmentQuotaUsage(
  manager: EntityManager,
  boardId: string,
  cardId: string,
): Promise<AttachmentQuotaUsage> {
  const row = await manager
    .getRepository(CardAttachment)
    .createQueryBuilder('asset')
    .select(
      "COUNT(*) FILTER (WHERE asset.cardId = :cardId AND asset.state IN ('PENDING','ACTIVE'))::text",
      'cardSlots',
    )
    .addSelect(
      "COALESCE(SUM(CASE WHEN asset.kind = 'FILE' AND asset.state = 'PENDING' THEN asset.reservedBytes WHEN asset.kind = 'FILE' AND asset.state = 'ACTIVE' THEN asset.byteSize ELSE 0 END),0)::text",
      'boardFileBytes',
    )
    .where('asset.boardId = :boardId', { boardId, cardId })
    .getRawOne<{ cardSlots: string; boardFileBytes: string }>();
  return {
    cardSlots: BigInt(row?.cardSlots ?? 0),
    boardFileBytes: BigInt(row?.boardFileBytes ?? 0),
  };
}
