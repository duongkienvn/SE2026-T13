import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { AuthService } from '../api/auth/auth.service';
import type { RealtimeSocket } from './realtime.types';

@Injectable()
export class RealtimeAuthService implements OnApplicationShutdown {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly auth: AuthService) {}

  async authenticate(socket: RealtimeSocket): Promise<void> {
    const token: unknown = socket.handshake.auth?.accessToken;
    if (typeof token !== 'string' || !token.trim()) throw this.unauthorized();
    try {
      socket.data.identity = await this.auth.authenticateAccessToken(token);
      if (socket.data.identity.expiresAt <= Date.now())
        throw this.unauthorized();
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
        socket.disconnect(true);
        this.cleanup(socket);
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
      socket.data.identity.expiresAt > Date.now()
    ) {
      return true;
    }
    socket.disconnect(true);
    return false;
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
