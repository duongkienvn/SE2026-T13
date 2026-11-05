import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AuthService } from '../api/auth/auth.service';
import type { RealtimeSocket } from './realtime.types';
import { BoardRoomCoordinator } from './board-room-coordinator.service';
import type { AuthenticatedUser } from '../api/auth/constants/auth.constants';

@Injectable()
export class RealtimeAuthService implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeAuthService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Immutable authenticated owner, independent of rooms, handshake fields or
   * mutable adapter data. Weak keys do not retain disconnected sockets.
   */
  private readonly owners = new WeakMap<
    RealtimeSocket,
    Readonly<AuthenticatedUser>
  >();

  constructor(
    private readonly auth: AuthService,
    private readonly coordinator: BoardRoomCoordinator,
  ) {}

  async authenticate(socket: RealtimeSocket): Promise<void> {
    const token: unknown = socket.handshake.auth?.accessToken;
    if (typeof token !== 'string' || !token.trim()) throw this.unauthorized();
    try {
      const identity = await this.auth.authenticateAccessToken(token);
      if (
        identity.expiresAt <= Date.now() ||
        this.coordinator.isSessionRevoked(identity)
      )
        throw this.unauthorized();
      socket.data.identity = identity;
      this.owners.set(socket, Object.freeze({ ...identity }));
    } catch {
      throw this.unauthorized();
    } finally {
      // Socket.IO retains handshake auth for the connection; discard the credential.
      delete socket.handshake.auth?.accessToken;
    }
  }

  connected(socket: RealtimeSocket): void {
    this.cleanup(socket);
    if (!this.isActive(socket)) return;
    const schedule = () => {
      const remaining = (socket.data.identity?.expiresAt ?? 0) - Date.now();
      if (remaining <= 0) {
        this.deactivate(socket);
        return;
      }
      // Node timers overflow above ~24 days; reschedule rather than expiring early.
      const timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
      timer.unref();
      this.timers.set(socket.id, timer);
    };
    schedule();
  }

  isActive(socket: RealtimeSocket): boolean {
    if (
      socket.connected &&
      socket.data.identity &&
      socket.data.identity.expiresAt > Date.now() &&
      !this.coordinator.isSessionRevoked(socket.data.identity)
    ) {
      return true;
    }
    this.deactivate(socket);
    return false;
  }

  currentUserVersion(userId: string): Promise<number | null> {
    return this.auth.currentSocketAuthVersion(userId);
  }

  isCurrentRecipient(
    socket: RealtimeSocket,
    userId: string,
    version: number | null,
  ): boolean {
    if (!this.isActive(socket)) return false;
    const owner = this.owners.get(socket);
    if (!owner || owner.userId !== userId) return false;
    if (
      version === null ||
      owner.authVersion !== version ||
      owner.expiresAt <= Date.now() ||
      socket.data.identity?.userId !== owner.userId ||
      socket.data.identity.authVersion !== owner.authVersion
    ) {
      this.deactivate(socket);
      return false;
    }
    return true;
  }

  private deactivate(socket: RealtimeSocket): void {
    this.cleanup(socket);
    // Revoke immediately; queued presence cleanup must not be awaited while a
    // caller (e.g. join/broadcast) holds the same board's coordinator.
    void this.coordinator.disconnect(socket);
    try {
      socket.disconnect(true);
    } catch {
      this.logger.error(
        'Expired socket disconnect failed; receive access revoked',
      );
    }
  }

  cleanup(socket: RealtimeSocket): void {
    const timer = this.timers.get(socket.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(socket.id);
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private unauthorized(): Error & { data: { code: string } } {
    return Object.assign(new Error('Unauthorized'), {
      data: { code: 'UNAUTHORIZED' },
    });
  }
}
