import { randomBytes } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateWorkspaceInvitationDto,
  AcceptWorkspaceInvitationDto,
  DeclineWorkspaceInvitationDto,
  WorkspaceInvitationsQueryDto,
  toWorkspaceInvitationDto,
} from '../../src/api/workspaces/dto/workspace-invitations.dto';
import {
  UpdateWorkspaceMemberDto,
  WorkspaceMembersQueryDto,
} from '../../src/api/workspaces/dto/workspace-members.dto';
import { WorkspaceInvitation } from '../../src/api/workspaces/entities/workspace-invitation.entity';
import { invitationHash } from '../../src/api/workspaces/workspace-invitation-issuance.service';
import { WorkspaceRole } from '@kanban/shared';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

describe('Workspace invitation and member trust boundaries', () => {
  it('normalizes email, defaults MEMBER and rejects privileged or unknown input', async () => {
    const value = plainToInstance(CreateWorkspaceInvitationDto, {
      email: ' Target@Example.com ',
    });
    expect(await validate(value)).toEqual([]);
    expect(value.email).toBe('target@example.com');
    expect(value.role).toBe('MEMBER');
    for (const patch of [
      { email: 'bad' },
      { email: 'a'.repeat(321) },
      { role: 'ADMIN' },
      { role: null },
      { invitedById: 'impersonator' },
      { tokenHash: 'injected' },
    ]) {
      expect(
        (
          await validate(
            plainToInstance(CreateWorkspaceInvitationDto, {
              email: 'target@example.com',
              ...patch,
            }),
            { whitelist: true, forbidNonWhitelisted: true },
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it('accepts only bounded opaque proof and hashes it without storing plaintext', async () => {
    const proof = randomBytes(32).toString('base64url');
    expect(
      await validate(plainToInstance(AcceptWorkspaceInvitationDto, { proof })),
    ).toEqual([]);
    expect(invitationHash(proof)).toMatch(/^[0-9a-f]{64}$/);
    expect(invitationHash(proof)).not.toBe(proof);
    expect(invitationHash(randomBytes(32).toString('base64url'))).not.toBe(
      invitationHash(proof),
    );
    for (const value of [
      null,
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      'a'.repeat(42) + '/',
      123,
    ])
      expect(
        (
          await validate(
            plainToInstance(AcceptWorkspaceInvitationDto, { proof: value }),
          )
        ).length,
      ).toBeGreaterThan(0);
  });

  it('bounds pages, filters and search and rejects foreign Board roles', async () => {
    expect(
      await validate(
        plainToInstance(WorkspaceInvitationsQueryDto, { status: 'DECLINED' }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(DeclineWorkspaceInvitationDto, {
          proof: 'a'.repeat(43),
        }),
      ),
    ).toEqual([]);
    for (const input of [
      {},
      { proof: null },
      { proof: 'x'.repeat(42) },
      { proof: '/'.repeat(43) },
      { proof: ['a'.repeat(43)] },
      { proof: 'a'.repeat(43), email: 'injected@example.test' },
    ])
      expect(
        (
          await validate(
            plainToInstance(DeclineWorkspaceInvitationDto, input),
            { whitelist: true, forbidNonWhitelisted: true },
          )
        ).length,
      ).toBeGreaterThan(0);
    for (const [kind, input] of [
      [WorkspaceInvitationsQueryDto, { status: 'SENT' }],
      [WorkspaceInvitationsQueryDto, { limit: '101' }],
      [WorkspaceInvitationsQueryDto, { page: '1000001' }],
      [WorkspaceMembersQueryDto, { search: null }],
      [WorkspaceMembersQueryDto, { search: 'x'.repeat(121) }],
      [WorkspaceMembersQueryDto, { role: 'OWNER' }],
      [UpdateWorkspaceMemberDto, { role: 'OWNER' }],
    ] as const) {
      expect(
        (await validate(plainToInstance<object, unknown>(kind, input))).length,
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(
        plainToInstance(UpdateWorkspaceMemberDto, { role: 'ADMIN' }),
      ),
    ).toEqual([]);
  });

  it('allowlists history, gives terminal states priority, and never returns proof/hash', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const expiry = new Date('2026-01-08T00:00:00Z');
    const invitation: WorkspaceInvitation = Object.assign(
      new WorkspaceInvitation(),
      {
        id: 'id',
        workspaceId: 'workspace',
        email: 'target@example.com',
        role: WorkspaceRole.MEMBER,
        tokenHash: 'a'.repeat(64),
        proof: 'secret',
        sendState: 'UNAVAILABLE',
        invitedById: 'actor',
        createdAt: created,
        updatedAt: created,
        expiresAt: expiry,
        revokedAt: null,
        consumedAt: null,
        declinedAt: null,
      },
    );
    expect(toWorkspaceInvitationDto(invitation, created).status).toBe(
      'PENDING',
    );
    expect(toWorkspaceInvitationDto(invitation, expiry).status).toBe('EXPIRED');
    invitation.revokedAt = created;
    expect(toWorkspaceInvitationDto(invitation, expiry).status).toBe('REVOKED');
    invitation.revokedAt = null;
    invitation.declinedAt = created;
    expect(toWorkspaceInvitationDto(invitation, expiry)).toMatchObject({
      status: 'DECLINED',
      declinedAt: created.toISOString(),
    });
    invitation.declinedAt = null;
    invitation.consumedAt = created;
    const result = toWorkspaceInvitationDto(invitation, expiry);
    expect(result.status).toBe('ACCEPTED');
    expect(result.declinedAt).toBeNull();
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).not.toHaveProperty('proof');
  });
});
