import { AuthorEnrichmentGateway } from './author-enrichment.gateway';
import { AUTHOR_ENRICHMENT_STATUS_EVENT } from './author-enrichment.gateway';
import { Permission } from '@projectx/types';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateUser: vi.fn() };
  const queueRepo = { getStatusSummary: vi.fn() };
  const enrichmentConfig = { isPaused: vi.fn() };
  const session = { getSnapshot: vi.fn() };
  const configService = { get: vi.fn().mockReturnValue('http://localhost:5173') };

  const gateway = new AuthorEnrichmentGateway(
    jwtService as any,
    authService as any,
    queueRepo as any,
    enrichmentConfig as any,
    session as any,
    configService as any,
  );

  return { gateway, jwtService, authService, queueRepo, enrichmentConfig, session };
}

describe('AuthorEnrichmentGateway', () => {
  it('emitStatus broadcasts to connected sockets', () => {
    const { gateway } = makeGateway();
    const emit = vi.fn();
    gateway['server'] = { emit } as any;

    gateway.emitStatus({
      queued: 2,
      processing: 1,
      rateLimited: 0,
      failed: 0,
      done: 10,
      total: 13,
    });

    expect(emit).toHaveBeenCalledWith('author-enrichment:status', {
      queued: 2,
      processing: 1,
      rateLimited: 0,
      failed: 0,
      done: 10,
      total: 13,
    });
  });

  it('emitStatus does not throw when server is undefined', () => {
    const { gateway } = makeGateway();
    gateway['server'] = undefined as any;

    expect(() =>
      gateway.emitStatus({
        queued: 0,
        processing: 0,
        rateLimited: 0,
        failed: 0,
        done: 0,
        total: 0,
      }),
    ).not.toThrow();
  });

  it('afterInit injects runtime cors origin and credentials on socket engine', () => {
    const { gateway } = makeGateway();
    const server = { engine: { opts: { cors: { methods: ['GET'] } } } } as any;

    gateway.afterInit(server);

    expect(server.engine.opts.cors).toEqual({
      methods: ['GET'],
      origin: 'http://localhost:5173',
      credentials: true,
    });
  });

  it('afterInit safely no-ops when engine options are unavailable', () => {
    const { gateway } = makeGateway();
    expect(() => gateway.afterInit({} as any)).not.toThrow();
  });

  it('handleConnection rejects missing token and disconnects socket', async () => {
    const { gateway } = makeGateway();
    const client = {
      id: 'sock-1',
      handshake: { auth: {} },
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('handleConnection emits snapshot when user has required permission', async () => {
    const { gateway, jwtService, authService, queueRepo, enrichmentConfig, session } = makeGateway();
    const user = { id: 11, isSuperuser: false, permissions: [Permission.ManageMetadataConfig] };
    jwtService.verify.mockReturnValue({ sub: 11, ver: 2 });
    authService.validateUser.mockResolvedValue(user);
    queueRepo.getStatusSummary.mockResolvedValue({ queued: 3, processing: 1, rateLimited: 0, failed: 0, done: 2, total: 6 });
    enrichmentConfig.isPaused.mockResolvedValue(true);
    session.getSnapshot.mockReturnValue({ sessionTotal: 6, sessionDone: 2, currentItemName: 'Alice' });
    const client = {
      id: 'sock-2',
      handshake: { auth: { token: 'jwt' } },
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(authService.validateUser).toHaveBeenCalledWith(11, 2);
    expect(client.emit).toHaveBeenCalledWith(AUTHOR_ENRICHMENT_STATUS_EVENT, {
      queued: 3,
      processing: 1,
      rateLimited: 0,
      failed: 0,
      done: 2,
      total: 6,
      paused: true,
      sessionTotal: 6,
      sessionDone: 2,
      currentItemName: 'Alice',
    });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('handleConnection rejects connected users without enrichment-status permission', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 7, ver: 1 });
    authService.validateUser.mockResolvedValue({ id: 7, isSuperuser: false, permissions: [] });
    const client = {
      id: 'sock-3',
      handshake: { auth: { token: 'jwt' } },
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.emit).not.toHaveBeenCalled();
  });
});
