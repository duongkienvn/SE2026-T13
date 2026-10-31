import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BoardMemberAddedMailer,
  type BoardMemberAddedMail,
} from '../../mail/board-member-added-mailer';
import { BoardMember } from './entities/board-member.entity';

export const BOARD_MEMBER_ADDED_TIMEOUT_MS = 10_000;

/** Best effort only. Call after commit, never from a transaction callback. */
@Injectable()
export class BoardMemberAddedNotificationService {
  private readonly logger = new Logger(
    BoardMemberAddedNotificationService.name,
  );

  constructor(
    @InjectRepository(BoardMember)
    private readonly members: Repository<BoardMember>,
    private readonly mailer: BoardMemberAddedMailer,
  ) {}

  async notify(payload: BoardMemberAddedMail): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<'UNKNOWN'>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve('UNKNOWN');
        }, BOARD_MEMBER_ADDED_TIMEOUT_MS);
      });
      const dispatch = async () => {
        // Suppress a removal already observed before dispatch, including a
        // remove/re-add with a different membership ID. No network IO in locks.
        if (!(await this.members.existsBy({ id: payload.membershipId })))
          return 'SKIPPED';
        if (controller.signal.aborted) return 'UNKNOWN';
        return this.mailer.send(payload, controller.signal);
      };
      // Race also bounds an adapter/read that ignores abort. Promise.race observes
      // late rejections; the abort check prevents a late read from starting mail.
      const result = await Promise.race([dispatch(), deadline]);
      if (result === 'FAILED' || result === 'UNKNOWN')
        this.logger.warn(`Board member added notification: ${result}`);
    } catch {
      // Never log raw errors, recipient, Board/actor data, credentials or URLs.
      this.logger.warn('Board member added notification: FAILED');
    } finally {
      clearTimeout(timer);
    }
  }
}
