import { DisabledAttachmentStorage } from '../../src/api/cards/attachments/attachment-storage';
import {
  ATTACHMENT_CARD_SLOT_LIMIT,
  ATTACHMENT_FILE_POLICY_PROPOSAL,
} from '../../src/api/cards/attachments/attachment-policy';

describe('attachment file extension boundary', () => {
  it('fails every storage operation honestly without file I/O or configuration', async () => {
    const storage = new DisabledAttachmentStorage();
    expect(storage.available).toBe(false);
    for (const operation of [
      () => storage.createUploadGrant(),
      () => storage.read(),
      () => storage.writeVerified(),
      () => storage.delete(),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        response: { code: 'ATTACHMENT_FILES_NOT_AVAILABLE' },
      });
    }
  });
  it('keeps the unapproved proposal distinct from the implemented metadata safeguard', () => {
    expect(ATTACHMENT_CARD_SLOT_LIMIT).toBe(20);
    expect(ATTACHMENT_FILE_POLICY_PROPOSAL.approval).toBe(
      'REQUIRES_OWNER_REVIEW',
    );
    expect(ATTACHMENT_FILE_POLICY_PROPOSAL.maximumFileBytes).toBe(
      10 * 1024 * 1024,
    );
    expect(ATTACHMENT_FILE_POLICY_PROPOSAL.maximumBoardFileBytes).toBe(
      100 * 1024 * 1024,
    );
    expect(Object.keys(ATTACHMENT_FILE_POLICY_PROPOSAL.allowedTypes)).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
      'text/plain',
    ]);
    expect(ATTACHMENT_FILE_POLICY_PROPOSAL.inlineTypes).not.toContain(
      'application/pdf',
    );
    expect(Object.isFrozen(ATTACHMENT_FILE_POLICY_PROPOSAL.allowedTypes)).toBe(
      true,
    );
  });
});
