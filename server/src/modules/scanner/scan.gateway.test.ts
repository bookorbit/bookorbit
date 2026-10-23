import type { BookMissingEvent, BookTransferredEvent, CoverRefreshedEvent, ScanProgressEvent } from '@bookorbit/types';

import { ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, AchievementEventsService } from '../achievement/achievement-events.service';
import { ScanGateway } from './scan.gateway';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateSessionUser: vi.fn() };
  const scanJobStore = { get: vi.fn(), isRunning: vi.fn() };
  const scannerRepository = { hasLibraryAccess: vi.fn().mockResolvedValue(false) };
  const achievementEvents = new AchievementEventsService();
  const appConfiguration = { appUrl: 'http://localhost:6263' };
  const gateway = new ScanGateway(
    jwtService as any,
    authService as any,
    scanJobStore as any,
    scannerRepository as any,
    achievementEvents,
    appConfiguration as any,
  );
  return { gateway, jwtService, authService, scanJobStore, scannerRepository, achievementEvents };
}

const reader = { id: 42, username: 'reader', isSuperuser: false };
const admin = { id: 1, username: 'admin', isSuperuser: true };

function subscriber(user?: object) {
  return { id: 'sock-sub', data: user ? { user } : {}, join: vi.fn().mockResolvedValue(undefined), emit: vi.fn() } as any;
}

const runningScan = { jobId: 9, processed: 50, total: 200, added: 10, updated: 5, missing: 2 };

function mockServer() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  return { server: { to, emit }, to, emit };
}

// ── book:missing ──────────────────────────────────────────────────────────────

describe('emitBookMissing', () => {
  it('emits book:missing to the correct library room', () => {
    const { gateway } = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    const event: BookMissingEvent = { libraryId: 7, bookIds: [1, 2, 3] };
    gateway.emitBookMissing(event);

    expect(to).toHaveBeenCalledWith('library:7');
    expect(emit).toHaveBeenCalledWith('book:missing', event);
  });

  it('does not throw when server is undefined (application context)', () => {
    const { gateway } = makeGateway();
    gateway['server'] = undefined as any;

    expect(() => gateway.emitBookMissing({ libraryId: 1, bookIds: [1] })).not.toThrow();
  });
});

// ── pre-existing emit methods (regression) ────────────────────────────────────

describe('emitProgress', () => {
  it('emits scan:progress to the correct room', () => {
    const { gateway } = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    const event: ScanProgressEvent = {
      jobId: 1,
      libraryId: 4,
      status: 'running',
      processed: 10,
      total: 20,
      added: 5,
      updated: 2,
      missing: 0,
    };
    gateway.emitProgress(event);

    expect(to).toHaveBeenCalledWith('library:4');
    expect(emit).toHaveBeenCalledWith('scan:progress', event);
  });

  it('does not throw when server is undefined', () => {
    const { gateway } = makeGateway();
    gateway['server'] = undefined as any;

    expect(() =>
      gateway.emitProgress({ jobId: 1, libraryId: 1, status: 'running', processed: 0, total: 0, added: 0, updated: 0, missing: 0 }),
    ).not.toThrow();
  });
});

describe('emitCoverRefreshed', () => {
  it('emits cover:refreshed to the correct room', () => {
    const { gateway } = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    const event: CoverRefreshedEvent = { bookIds: [9], libraryId: 2 };
    gateway.emitCoverRefreshed(event);

    expect(to).toHaveBeenCalledWith('library:2');
    expect(emit).toHaveBeenCalledWith('cover:refreshed', event);
  });
});

describe('handleConnection', () => {
  it('stores validated user on the socket when token is valid', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 42, ver: 3 });
    authService.validateSessionUser.mockResolvedValue({ id: 42, username: 'reader' });
    const disconnect = vi.fn();
    const join = vi.fn().mockResolvedValue(undefined);
    const client = {
      id: 'sock-1',
      handshake: { auth: { token: 'valid' } },
      data: {},
      disconnect,
      join,
      emit: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(jwtService.verify).toHaveBeenCalledWith('valid', { algorithms: ['HS256'] });
    expect(authService.validateSessionUser).toHaveBeenCalledWith(42, 3, 'legacy', undefined);
    expect(client.data.user).toEqual({ id: 42, username: 'reader' });
    expect(join).toHaveBeenCalledWith('user:42');
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('disconnects the socket when token is missing or invalid', async () => {
    const { gateway, jwtService } = makeGateway();
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    const disconnect = vi.fn();
    const emit = vi.fn();
    const client = {
      id: 'sock-2',
      handshake: { auth: {} },
      data: {},
      disconnect,
      emit,
    } as any;

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('book progress events', () => {
  it('forwards progress changes only to the affected user room and removes its listener on destroy', () => {
    const { gateway, achievementEvents } = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;
    gateway.onModuleInit();

    achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
      userId: 42,
      bookId: 142,
      bookFileId: 165,
      progress: 61.02,
      source: 'koreader',
    });

    expect(to).toHaveBeenCalledWith('user:42');
    expect(emit).toHaveBeenCalledWith('book:progress-changed', {
      bookId: 142,
      progress: 61.02,
      source: 'koreader',
    });

    gateway.onModuleDestroy();
    to.mockClear();
    achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
      userId: 42,
      bookId: 142,
      progress: 70,
      source: 'koreader',
    });

    expect(to).not.toHaveBeenCalled();
  });
});

describe('subscription lifecycle', () => {
  it('afterInit injects runtime cors origin and credentials on socket engine', () => {
    const { gateway } = makeGateway();
    const server = { engine: { opts: { cors: { methods: ['GET'] } } } } as any;

    gateway.afterInit(server);

    expect(server.engine.opts.cors).toEqual({
      methods: ['GET'],
      origin: 'http://localhost:6263',
      credentials: true,
    });
  });

  it('afterInit safely no-ops when engine options are unavailable', () => {
    const { gateway } = makeGateway();
    expect(() => gateway.afterInit({} as any)).not.toThrow();
  });

  it('logs disconnects without throwing', () => {
    const { gateway } = makeGateway();
    expect(() => gateway.handleDisconnect({ id: 'sock-3' } as any)).not.toThrow();
  });
});

describe('subscribe:library', () => {
  it('joins the room and sends the in-flight scan snapshot to a user with access to the library', async () => {
    const { gateway, scanJobStore, scannerRepository } = makeGateway();
    scannerRepository.hasLibraryAccess.mockResolvedValue(true);
    scanJobStore.get.mockReturnValue(runningScan);
    const client = subscriber(reader);

    await gateway.handleSubscribeLibrary(client, 88);

    expect(scannerRepository.hasLibraryAccess).toHaveBeenCalledWith(42, 88);
    expect(client.join).toHaveBeenCalledWith('library:88');
    expect(client.emit).toHaveBeenCalledWith('scan:progress', {
      jobId: 9,
      libraryId: 88,
      status: 'running',
      processed: 50,
      total: 200,
      added: 10,
      updated: 5,
      missing: 2,
    });
  });

  it('subscribes without emitting progress when no scan entry exists', async () => {
    const { gateway, scanJobStore, scannerRepository } = makeGateway();
    scannerRepository.hasLibraryAccess.mockResolvedValue(true);
    scanJobStore.get.mockReturnValue(undefined);
    const client = subscriber(reader);

    await gateway.handleSubscribeLibrary(client, 7);

    expect(client.join).toHaveBeenCalledWith('library:7');
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('lets a superuser into any library without an access row', async () => {
    const { gateway, scannerRepository } = makeGateway();
    const client = subscriber(admin);

    await gateway.handleSubscribeLibrary(client, 5);

    expect(scannerRepository.hasLibraryAccess).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('library:5');
  });

  it('keeps a user out of a library they cannot read, so its book cards and scan counts never reach them', async () => {
    const { gateway, scanJobStore, scannerRepository } = makeGateway();
    scannerRepository.hasLibraryAccess.mockResolvedValue(false);
    scanJobStore.get.mockReturnValue(runningScan);
    const client = subscriber(reader);

    await gateway.handleSubscribeLibrary(client, 3);

    expect(scannerRepository.hasLibraryAccess).toHaveBeenCalledWith(42, 3);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('ignores a socket that never authenticated', async () => {
    const { gateway, scanJobStore, scannerRepository } = makeGateway();
    scanJobStore.get.mockReturnValue(runningScan);
    const client = subscriber();

    await gateway.handleSubscribeLibrary(client, 3);

    expect(scannerRepository.hasLibraryAccess).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, '7', null, undefined, { id: 7 }])('ignores the malformed library id %s without querying', async (libraryId) => {
    const { gateway, scannerRepository } = makeGateway();
    const client = subscriber(admin);

    await gateway.handleSubscribeLibrary(client, libraryId as never);

    expect(scannerRepository.hasLibraryAccess).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('holds a subscription that arrives mid-handshake until the token check finishes, then honours it', async () => {
    const { gateway, jwtService, authService, scannerRepository } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 42, ver: 3, sid: 11 });
    let finishSessionCheck!: (user: object) => void;
    authService.validateSessionUser.mockReturnValue(new Promise((done) => (finishSessionCheck = done)));
    scannerRepository.hasLibraryAccess.mockResolvedValue(true);
    const client = { ...subscriber(), handshake: { auth: { token: 'valid' } }, disconnect: vi.fn() } as any;

    const connected = gateway.handleConnection(client);
    const subscribed = gateway.handleSubscribeLibrary(client, 88);
    await Promise.resolve();
    expect(client.join).not.toHaveBeenCalledWith('library:88');

    finishSessionCheck(reader);
    await Promise.all([connected, subscribed]);

    expect(client.join).toHaveBeenCalledWith('user:42');
    expect(client.join).toHaveBeenCalledWith('library:88');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('drops a subscription that arrives mid-handshake when the handshake is refused', async () => {
    const { gateway, jwtService, authService, scannerRepository } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 42, ver: 3, sid: 11 });
    let finishSessionCheck!: (user: object | null) => void;
    authService.validateSessionUser.mockReturnValue(new Promise((done) => (finishSessionCheck = done)));
    const client = { ...subscriber(), handshake: { auth: { token: 'revoked' } }, disconnect: vi.fn() } as any;

    const connected = gateway.handleConnection(client);
    const subscribed = gateway.handleSubscribeLibrary(client, 88);
    finishSessionCheck(null);
    await Promise.all([connected, subscribed]);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(scannerRepository.hasLibraryAccess).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });
});

describe('remaining emit methods', () => {
  it('emits cover refresh progress and books added events', () => {
    const { gateway } = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    gateway.emitCoverRefreshProgress({ libraryId: 6, processed: 1, total: 3, status: 'running' });
    gateway.emitBooksAdded({ libraryId: 6, books: [{ id: 10 }] as any });

    expect(to).toHaveBeenCalledWith('library:6');
    expect(emit).toHaveBeenCalledWith('cover:refresh:progress', { libraryId: 6, processed: 1, total: 3, status: 'running' });
    expect(emit).toHaveBeenCalledWith('scan:books:added', { libraryId: 6, books: [{ id: 10 }] });
  });

  it('emits restored and moved book notifications to the library room', () => {
    const { gateway } = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    gateway.emitBookRestored({ libraryId: 3, bookIds: [2, 4] });
    gateway.emitBookMoved({ libraryId: 3, bookIds: [2, 4] });

    expect(to).toHaveBeenCalledWith('library:3');
    expect(emit).toHaveBeenCalledWith('book:restored', { libraryId: 3, bookIds: [2, 4] });
    expect(emit).toHaveBeenCalledWith('book:moved', { libraryId: 3, bookIds: [2, 4] });
  });

  it('emits transferred book notifications to the source and destination library rooms', () => {
    const { gateway } = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    const event: BookTransferredEvent = { fromLibraryId: 3, toLibraryId: 8, bookIds: [2, 4] };
    gateway.emitBookTransferred(event);

    expect(to).toHaveBeenCalledWith(['library:3', 'library:8']);
    expect(emit).toHaveBeenCalledWith('book:transferred', event);
  });
});
