import type { NativeSocket } from '../../src/infrastructure/realtime/socket.ts';
import type { BoardRoomRequest } from '@kanban/shared';
export class FakeSocket implements NativeSocket {
  connected = false;
  connects = 0;
  disconnects = 0;
  readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  readonly commands: {
    event: string;
    boardId: string;
    ack(value: unknown): void;
  }[] = [];
  readonly credential: () => string | null;
  lastToken: string | null = null;
  constructor(credential: () => string | null) {
    this.credential = credential;
  }
  on(event: string, callback: (...args: unknown[]) => void) {
    const list = this.listeners.get(event) ?? [];
    list.push(callback);
    this.listeners.set(event, list);
  }
  emit(
    event: 'board:join' | 'board:leave',
    request: BoardRoomRequest,
    ack: (value: unknown) => void,
  ) {
    this.commands.push({ event, boardId: request.boardId, ack });
  }
  connect() {
    this.connects++;
    this.lastToken = this.credential();
  }
  disconnect() {
    this.connected = false;
    this.disconnects++;
  }
  removeAllListeners() {
    this.listeners.clear();
  }
  server(event: string, value?: unknown) {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const callback of [...(this.listeners.get(event) ?? [])])
      callback(value);
  }
  ack(
    index: number,
    result: unknown = { success: true, boardId: this.commands[index]?.boardId },
  ) {
    this.commands[index]!.ack(result);
  }
}
