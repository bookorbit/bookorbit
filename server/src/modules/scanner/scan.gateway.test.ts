import type { BookMissingEvent, CoverRefreshedEvent, ScanProgressEvent } from '@projectx/types';

import { ScanGateway } from './scan.gateway';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateUser: vi.fn() };
  const scanJobStore = { get: vi.fn(), isRunning: vi.fn() };
  const gateway = new ScanGateway(jwtService as any, authService as any, scanJobStore as any);
  return { gateway, jwtService, authService, scanJobStore };
}

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

    const event: CoverRefreshedEvent = { bookId: 9, libraryId: 2 };
    gateway.emitCoverRefreshed(event);

    expect(to).toHaveBeenCalledWith('library:2');
    expect(emit).toHaveBeenCalledWith('cover:refreshed', event);
  });
});

describe('handleConnection', () => {
  it('stores validated user on the socket when token is valid', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 42, ver: 3 });
    authService.validateUser.mockResolvedValue({ id: 42, username: 'reader' });
    const disconnect = vi.fn();
    const client = {
      id: 'sock-1',
      handshake: { auth: { token: 'valid' } },
      data: {},
      disconnect,
    } as any;

    await gateway.handleConnection(client);

    expect(jwtService.verify).toHaveBeenCalledWith('valid');
    expect(authService.validateUser).toHaveBeenCalledWith(42, 3);
    expect(client.data.user).toEqual({ id: 42, username: 'reader' });
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('disconnects the socket when token is missing or invalid', async () => {
    const { gateway, jwtService } = makeGateway();
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    const disconnect = vi.fn();
    const client = {
      id: 'sock-2',
      handshake: { auth: {} },
      data: {},
      disconnect,
    } as any;

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('subscription lifecycle', () => {
  it('logs disconnects and emits an in-flight progress snapshot on subscribe', () => {
    const { gateway, scanJobStore } = makeGateway();
    scanJobStore.get.mockReturnValue({
      jobId: 9,
      processed: 50,
      total: 200,
      added: 10,
      updated: 5,
      missing: 2,
    });
    const join = vi.fn();
    const emit = vi.fn();
    const client = { join, emit } as any;

    gateway.handleSubscribeLibrary(client, 88);
    gateway.handleDisconnect({ id: 'sock-3' } as any);

    expect(join).toHaveBeenCalledWith('library:88');
    expect(emit).toHaveBeenCalledWith('scan:progress', {
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

  it('subscribes without emitting progress when no scan entry exists', () => {
    const { gateway, scanJobStore } = makeGateway();
    scanJobStore.get.mockReturnValue(undefined);
    const join = vi.fn();
    const emit = vi.fn();
    const client = { join, emit } as any;

    gateway.handleSubscribeLibrary(client, 7);

    expect(join).toHaveBeenCalledWith('library:7');
    expect(emit).not.toHaveBeenCalled();
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
});
