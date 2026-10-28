import { Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WorkspaceRole } from '@kanban/shared';
import { Workspace } from '../../src/api/workspaces/entities/workspace.entity';
import { WorkspacesService } from '../../src/api/workspaces/workspaces.service';
import { WorkspaceInvitationIssuanceService } from '../../src/api/workspaces/workspace-invitation-issuance.service';
import type {
  WorkspaceInvitationMail,
  WorkspaceInvitationMailer,
} from '../../src/api/workspaces/workspace-invitation-mailer';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const payload: WorkspaceInvitationMail = {
  invitationId: 'invitation',
  workspaceId: 'workspace',
  workspaceName: 'Team',
  recipient: 'target@example.test',
  role: WorkspaceRole.MEMBER,
  proof: 'ephemeral-proof',
  expiresAt: new Date('2026-11-01T00:00:00Z'),
  idempotencyKey: 'workspace-invitation/invitation',
};
const repository = new DataSource({ type: 'postgres' }).getRepository(
  Workspace,
);
const service = (mailer: WorkspaceInvitationMailer) =>
  new WorkspaceInvitationIssuanceService(
    repository,
    new WorkspacesService(repository),
    mailer,
  );

describe('Workspace invitation dispatch boundary', () => {
  afterEach(() => jest.useRealTimers());

  it.each(['SENT', 'FAILED', 'UNKNOWN'] as const)(
    'preserves explicit %s outcome without retrying the proof',
    async (outcome) => {
      const send = jest.fn(async () => outcome);
      expect(await service({ send })['dispatch'](payload)).toBe(outcome);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(payload);
    },
  );

  it('maps a thrown transport error to UNKNOWN without exposing its proof', async () => {
    const send = jest.fn(async () => {
      throw new Error(payload.proof);
    });
    expect(await service({ send })['dispatch'](payload)).toBe('UNKNOWN');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('bounds an unresponsive adapter and ignores a late success', async () => {
    jest.useFakeTimers();
    let complete: (outcome: 'SENT') => void = () => {
      throw new Error('Dispatch has not started');
    };
    const send = jest.fn(
      () =>
        new Promise<'SENT'>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = service({ send })['dispatch'](payload);
    await jest.advanceTimersByTimeAsync(30000);
    expect(await pending).toBe('UNKNOWN');
    complete('SENT');
    expect(await pending).toBe('UNKNOWN');
    expect(send).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
