import { Inject, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  BoardMemberAddedNotificationService,
  BOARD_MEMBER_ADDED_TIMEOUT_MS,
} from '../../src/api/board-members/board-member-added-notification.service';
import { BoardMember } from '../../src/api/board-members/entities/board-member.entity';
import { BoardMemberAddedMail } from '../../src/mail/board-member-added-mailer';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const payload: BoardMemberAddedMail = {
  membershipId: 'membership',
  boardId: 'board',
  boardName: 'Private board',
  recipient: 'private@example.test',
  actorDisplayName: 'Private actor',
};

describe('post-commit Board member notification failure boundary', () => {
  const members = { existsBy: jest.fn() };
  const mailer = { send: jest.fn() };
  const service = new BoardMemberAddedNotificationService(
    members as unknown as Repository<BoardMember>,
    mailer,
  );
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.resetAllMocks();
    members.existsBy.mockResolvedValue(true);
    mailer.send.mockResolvedValue('SENT');
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  it.each(['FAILED', 'UNKNOWN'])(
    'observes %s without leaking content or failing the mutation',
    async (result) => {
      mailer.send.mockResolvedValue(result);
      await expect(service.notify(payload)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        `Board member added notification: ${result}`,
      );
      expect(mailer.send).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['read', 'send'])('isolates a thrown %s failure', async (phase) => {
    (phase === 'read' ? members.existsBy : mailer.send).mockRejectedValue(
      new Error(JSON.stringify(payload)),
    );
    await expect(service.notify(payload)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'Board member added notification: FAILED',
    );
  });

  it('suppresses mail for a membership removed before dispatch', async () => {
    members.existsBy.mockResolvedValue(false);
    await service.notify(payload);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('bounds an uncooperative send, aborts, and observes a late rejection with no retry', async () => {
    jest.useFakeTimers();
    let reject!: (error: Error) => void;
    mailer.send.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const pending = service.notify(payload);
    await jest.advanceTimersByTimeAsync(BOARD_MEMBER_ADDED_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(mailer.send.mock.calls[0][1].aborted).toBe(true);
    reject(new Error('late private provider body'));
    await jest.advanceTimersByTimeAsync(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Board member added notification: UNKNOWN',
    );
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not start mail when a preflight read resolves after the deadline', async () => {
    jest.useFakeTimers();
    let finish!: (exists: boolean) => void;
    members.existsBy.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.notify(payload);
    await jest.advanceTimersByTimeAsync(BOARD_MEMBER_ADDED_TIMEOUT_MS);
    await pending;
    finish(true);
    await jest.advanceTimersByTimeAsync(1);
    expect(mailer.send).not.toHaveBeenCalled();
  });
});
