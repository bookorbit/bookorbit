import { ForbiddenException, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { AiJobsChangedEvent } from '@bookorbit/types';
import { Server, Socket } from 'socket.io';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { rejectSocketConnection, trackSocketHandshake } from '../../common/utils/ws-auth.utils';
import { wsCorsOrigin } from '../../common/utils/ws-cors.utils';
import { AuthenticatorService } from '../auth/authenticator.service';
import { AiFeatureRegistry } from './ai-feature.registry';
import { AI_JOB_CHANGED, AiJobChanges, type AiJobChange } from './ai-job-changes.service';
import { mayRun } from './ai-job-checks.service';
import { managesAiJobs } from './ai-job-queue.service';

/** Changes heard within this window go out as one event, so a running build reaches a list as a few reads. */
export const AI_JOBS_PUSH_MS = 1_000;

export const AI_JOBS_CHANGED_EVENT = 'ai-jobs:changed';

/** Sockets of those who manage the server: they list every account's jobs. */
const MANAGERS_ROOM = 'ai-jobs:managers';

function userRoom(userId: number): string {
  return `ai-jobs:user:${userId}`;
}

/**
 * Tells the AI area that its lists moved, so it reads them again instead of polling. Events carry
 * no job data: what a viewer may see comes from the list route.
 *
 * A status change can move the place of every queued job, so it goes to every socket. Progress
 * goes only to those who can see the job: its requester and those who manage the server.
 */
@WebSocketGateway({ namespace: '/ai-jobs', cors: { origin: wsCorsOrigin() } })
export class AiJobsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server?: Server;
  private readonly logger = new Logger(AiJobsGateway.name);
  private readonly progressFor = new Set<number>();
  private stateChanged = false;
  private progressChanged = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handleChange = (change: AiJobChange): void => this.note(change);

  constructor(
    private readonly authenticator: AuthenticatorService,
    private readonly registry: AiFeatureRegistry,
    private readonly changes: AiJobChanges,
  ) {}

  onModuleInit(): void {
    this.changes.on(AI_JOB_CHANGED, this.handleChange);
  }

  onModuleDestroy(): void {
    this.changes.off(AI_JOB_CHANGED, this.handleChange);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  async handleConnection(client: Socket): Promise<void> {
    await trackSocketHandshake(client, this.authenticate(client));
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[ai_jobs.ws_connection] [end] socketId=${client.id} - websocket disconnected`);
  }

  /** Sends what the last window heard. Public for tests; the timer calls it otherwise. */
  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const state = this.stateChanged;
    const progress = this.progressChanged;
    const users = [...this.progressFor];
    this.stateChanged = false;
    this.progressChanged = false;
    this.progressFor.clear();
    if (!this.server) return;
    if (state) {
      const event: AiJobsChangedEvent = { state: true };
      this.server.emit(AI_JOBS_CHANGED_EVENT, event);
      return;
    }
    if (!progress) return;
    const event: AiJobsChangedEvent = { state: false };
    this.server.to([MANAGERS_ROOM, ...users.map(userRoom)]).emit(AI_JOBS_CHANGED_EVENT, event);
  }

  private note(change: AiJobChange): void {
    if (change.kind === 'state') this.stateChanged = true;
    else {
      this.progressChanged = true;
      if (change.requestedBy !== null) this.progressFor.add(change.requestedBy);
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), AI_JOBS_PUSH_MS);
    this.flushTimer.unref?.();
  }

  private async authenticate(client: Socket): Promise<RequestUser | null> {
    try {
      const user = await this.authenticator.authenticateSocket(client);
      // Read once at connect: a permission taken away mid session is caught by the token version.
      const manages = managesAiJobs(user);
      if (!manages && !this.registry.list().some((feature) => mayRun(user, feature))) {
        throw new ForbiddenException('Missing permission to see AI jobs');
      }
      (client.data as Record<string, unknown>).user = user;
      await client.join(manages ? [MANAGERS_ROOM, userRoom(user.id)] : [userRoom(user.id)]);
      this.logger.debug(`[ai_jobs.ws_connection] [start] userId=${user.id} socketId=${client.id} - websocket connected`);
      return user;
    } catch (err) {
      this.logger.warn(
        `[ai_jobs.ws_connection] [fail] socketId=${client.id} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - websocket rejected`,
      );
      rejectSocketConnection(client, err);
      return null;
    }
  }
}
