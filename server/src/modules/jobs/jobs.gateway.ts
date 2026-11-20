import { ForbiddenException, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { JobsChangedEvent, JobType } from '@bookorbit/types';
import { Server, Socket } from 'socket.io';

import { apiKeyCredentialOf, type RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { rejectSocketConnection, trackSocketHandshake } from '../../common/utils/ws-auth.utils';
import { wsCorsOrigin } from '../../common/utils/ws-cors.utils';
import { AuthenticatorService } from '../auth/authenticator.service';
import { JobChangesService, type JobChange } from './job-changes.service';
import { JobSourceRegistry } from './job-source.registry';

/** Changes heard within this window go out as one event per type. */
export const JOBS_PUSH_MS = 1_000;

export const JOBS_CHANGED_EVENT = 'jobs:changed';

/** Everyone who sees the type. */
export function typeRoom(type: JobType): string {
  return `t:${type}`;
}

/** Everyone who sees every account's jobs of the type. */
export function typeAllRoom(type: JobType): string {
  return `t:${type}:all`;
}

export function userRoom(userId: number): string {
  return `u:${userId}`;
}

interface Pending {
  state: boolean;
  /** Owners whose progress moved; ownerless progress reaches everyone-viewers only. */
  owners: Set<number>;
}

/**
 * Tells the Jobs area which types moved, so it reads its list again instead of polling. Events
 * carry no job data: what a viewer may see comes from the list route.
 *
 * A status change can move every queued job's place in its type, so it goes to everyone who sees
 * the type. Progress goes only to those who see the job: everyone-viewers and its owner. Signed-in
 * sessions only; an API key is refused, as on the routes. Rooms are read at connect, so
 * reconnecting picks up changed permissions.
 */
@WebSocketGateway({ namespace: '/jobs', cors: { origin: wsCorsOrigin() } })
export class JobsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server?: Server;
  private readonly logger = new Logger(JobsGateway.name);
  private readonly pending = new Map<JobType, Pending>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stopListening: (() => void) | null = null;

  constructor(
    private readonly authenticator: AuthenticatorService,
    private readonly registry: JobSourceRegistry,
    private readonly changes: JobChangesService,
  ) {}

  onModuleInit(): void {
    this.stopListening = this.changes.listen((change) => this.note(change));
  }

  onModuleDestroy(): void {
    this.stopListening?.();
    this.stopListening = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  async handleConnection(client: Socket): Promise<void> {
    await trackSocketHandshake(client, this.authenticate(client));
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[jobs.ws_connection] [end] socketId=${client.id} - websocket disconnected`);
  }

  /** Sends what the last window heard. Public for tests; the timer calls it otherwise. */
  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const pending = [...this.pending];
    this.pending.clear();
    if (!this.server) return;
    for (const [type, change] of pending) {
      const event: JobsChangedEvent = { type, state: change.state };
      if (change.state) {
        this.server.to(typeRoom(type)).emit(JOBS_CHANGED_EVENT, event);
        continue;
      }
      this.server.to([typeAllRoom(type), ...[...change.owners].map(userRoom)]).emit(JOBS_CHANGED_EVENT, event);
    }
  }

  private note(change: JobChange): void {
    const pending = this.pending.get(change.type) ?? { state: false, owners: new Set<number>() };
    if (change.state) pending.state = true;
    if (change.ownerId !== null) pending.owners.add(change.ownerId);
    this.pending.set(change.type, pending);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), JOBS_PUSH_MS);
    this.flushTimer.unref?.();
  }

  private rooms(user: RequestUser): string[] {
    const rooms: string[] = [];
    for (const source of this.registry.list()) {
      const access = source.access(user);
      if (!access.own && !access.all) continue;
      rooms.push(typeRoom(source.type));
      if (access.all) rooms.push(typeAllRoom(source.type));
    }
    return rooms;
  }

  private async authenticate(client: Socket): Promise<RequestUser | null> {
    try {
      const user = await this.authenticator.authenticateSocket(client);
      if (apiKeyCredentialOf(user)) throw new ForbiddenException('API keys cannot follow jobs');
      const rooms = this.rooms(user);
      if (rooms.length === 0) throw new ForbiddenException('Missing permission to see jobs');
      (client.data as Record<string, unknown>).user = user;
      await client.join([...rooms, userRoom(user.id)]);
      this.logger.debug(`[jobs.ws_connection] [start] userId=${user.id} socketId=${client.id} rooms=${rooms.length} - websocket connected`);
      return user;
    } catch (err) {
      this.logger.warn(
        `[jobs.ws_connection] [fail] socketId=${client.id} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - websocket rejected`,
      );
      rejectSocketConnection(client, err);
      return null;
    }
  }
}
