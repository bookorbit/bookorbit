import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { ScanProgressEvent } from '@bookorbit/types';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GlobalExceptionFilter } from '../../common/filters/http-exception.filter';
import { GLOBAL_GUARDS } from '../../common/guards/global-guards';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { PermissionService } from '../../common/services/permission.service';
import type { RequestUser } from '../../common/types/request-user';
import { appConfig } from '../../config/config';
import { DB } from '../../db';
import { AchievementEventsService } from '../achievement/achievement-events.service';
import { AuditEventsService } from '../audit/audit-events.service';
import { AuthService } from '../auth/auth.service';
import { ScanGateway } from './scan.gateway';
import { ScanJobStore } from './scan-job-store.service';
import { ScannerRepository } from './scanner.repository';

const READABLE_LIBRARY = 7;
const UNREADABLE_LIBRARY = 9;
const reader = { id: 42, username: 'reader', isSuperuser: false, permissions: [] } as unknown as RequestUser;

function progress(libraryId: number): ScanProgressEvent {
  return { jobId: 1, libraryId, status: 'running', processed: 1, total: 2, added: 0, updated: 0, missing: 0 };
}

/**
 * The scan gateway over a real socket.io connection, inside a Nest app that installs the same global
 * guards, interceptor, pipe and filter as production.
 *
 * Nest 12 started running global enhancers on gateway messages, and the HTTP JWT guard crashed every
 * `subscribe:library` on a missing Authorization header: issue 1743. Mocked execution contexts
 * cannot see that kind of change in the framework, so this goes through Nest's own message pipeline.
 */
describe('scan gateway over socket.io behind the global guards', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let gateway: ScanGateway;
  let scanJobStore: ScanJobStore;
  let token: string;
  const authService = { validateSessionUser: vi.fn<(...args: unknown[]) => Promise<RequestUser | null>>() };
  const scannerRepository = {
    hasLibraryAccess: vi.fn((_userId: number, libraryId: number) => Promise.resolve(libraryId === READABLE_LIBRARY)),
  };
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 1_000 }] })],
      providers: [
        ScanGateway,
        ScanJobStore,
        AchievementEventsService,
        AuditEventsService,
        { provide: JwtService, useValue: new JwtService({ secret: 'scan-gateway-socket-test' }) },
        { provide: AuthService, useValue: authService },
        { provide: ScannerRepository, useValue: scannerRepository },
        { provide: appConfig.KEY, useValue: { appUrl: 'http://localhost:6263' } },
        { provide: PermissionService, useValue: {} },
        { provide: DB, useValue: {} },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        ...GLOBAL_GUARDS.map((useClass) => ({ provide: APP_GUARD, useClass })),
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    app.useWebSocketAdapter(new IoAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();

    gateway = app.get(ScanGateway);
    scanJobStore = app.get(ScanJobStore);
    token = app.get(JwtService).sign({ sub: reader.id, ver: 3, sid: 11, amr: 'password' });
  });

  beforeEach(() => {
    authService.validateSessionUser.mockReset();
    scannerRepository.hasLibraryAccess.mockClear();
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
    scanJobStore.delete(READABLE_LIBRARY);
  });

  afterAll(async () => {
    await app?.close();
  });

  function connect(): ClientSocket {
    const client = io(`${baseUrl}/scan`, { transports: ['websocket'], auth: { token }, reconnection: false, forceNew: true });
    clients.push(client);
    return client;
  }

  /** Rejects as soon as Nest answers with an `exception` event, which is how a crashing guard surfaces. */
  function nextEvent<T>(client: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      client.once(event, resolve as never);
      client.once('exception', (error: unknown) => reject(new Error(`server answered with an exception: ${JSON.stringify(error)}`)));
    });
  }

  function collect(client: ClientSocket, event: string): unknown[] {
    const seen: unknown[] = [];
    client.on(event, (payload: unknown) => seen.push(payload));
    return seen;
  }

  /**
   * Keeps the handshake's session lookup open until the client's subscribe has reached the server
   * and had time to run, which is the order a fast client on a slow database produces.
   */
  function holdSessionCheckUntilSubscribe(user: RequestUser | null): void {
    let finish!: (value: RequestUser | null) => void;
    authService.validateSessionUser.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    gateway.server.once('connection', (socket) => {
      socket.prependAny((event: string) => {
        if (event === 'subscribe:library') setTimeout(() => finish(user), 50);
      });
    });
  }

  it('subscribes a client that asks the moment it connects, while its session is still being checked', async () => {
    scanJobStore.create(31, READABLE_LIBRARY, 200, 'manual');
    holdSessionCheckUntilSubscribe(reader);
    const client = connect();
    const exceptions = collect(client, 'exception');
    client.on('connect', () => client.emit('subscribe:library', READABLE_LIBRARY));

    const snapshot = await nextEvent<ScanProgressEvent>(client, 'scan:progress');

    expect(snapshot).toMatchObject({ jobId: 31, libraryId: READABLE_LIBRARY, status: 'running', total: 200 });
    expect(scannerRepository.hasLibraryAccess).toHaveBeenCalledWith(reader.id, READABLE_LIBRARY);
    expect(exceptions).toEqual([]);
  });

  it('broadcasts a library to subscribers who can read it and never to anyone else', async () => {
    authService.validateSessionUser.mockResolvedValue(reader);
    const client = connect();
    const exceptions = collect(client, 'exception');
    await nextEvent(client, 'connect');

    client.emit('subscribe:library', UNREADABLE_LIBRARY);
    client.emit('subscribe:library', READABLE_LIBRARY);
    await vi.waitFor(() => expect(gateway.server.adapter.rooms.get(`library:${READABLE_LIBRARY}`)?.has(client.id!)).toBe(true));
    expect(gateway.server.adapter.rooms.get(`library:${UNREADABLE_LIBRARY}`)?.has(client.id!) ?? false).toBe(false);

    // One connection delivers in order, so the readable event arriving first proves the other was never sent.
    const received = nextEvent<ScanProgressEvent>(client, 'scan:progress');
    gateway.emitProgress(progress(UNREADABLE_LIBRARY));
    gateway.emitProgress(progress(READABLE_LIBRARY));

    await expect(received).resolves.toMatchObject({ libraryId: READABLE_LIBRARY });
    expect(exceptions).toEqual([]);
  });

  it('drops a subscribe that arrives mid-handshake from a session that turns out to be revoked', async () => {
    holdSessionCheckUntilSubscribe(null);
    const client = connect();
    const unauthorized = collect(client, 'unauthorized');
    client.on('connect', () => client.emit('subscribe:library', READABLE_LIBRARY));

    await expect(nextEvent(client, 'disconnect')).resolves.toBe('io server disconnect');

    expect(unauthorized).toEqual([{ reason: 'invalid_token' }]);
    expect(scannerRepository.hasLibraryAccess).not.toHaveBeenCalled();
  });
});
