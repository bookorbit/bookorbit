import { Permission } from '@projectx/types';

import { BOOK_METADATA_FETCH_STATUS_EVENT, BookMetadataFetchGateway } from './book-metadata-fetch.gateway';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateUser: vi.fn() };
  const queueRepo = { getStatusSummary: vi.fn() };
  const configService = { isPaused: vi.fn() };
  const session = { getSnapshot: vi.fn() };
  const gateway = new BookMetadataFetchGateway(
    jwtService as never,
    authService as never,
    queueRepo as never,
    configService as never,
    session as never,
  );
  return { gateway, jwtService, authService, queueRepo, configService, session };
}

describe('BookMetadataFetchGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects websocket connection without token', async () => {
    const { gateway } = makeGateway();
    const client = {
      id: 'sock-1',
      handshake: { auth: {} },
      emit: vi.fn(),
      disconnect: vi.fn(),
      data: {},
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects authenticated users lacking metadata-config permission', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 5, ver: 3 });
    authService.validateUser.mockResolvedValue({ id: 5, isSuperuser: false, permissions: [] });
    const client = {
      id: 'sock-2',
      handshake: { auth: { token: 'jwt' } },
      emit: vi.fn(),
      disconnect: vi.fn(),
      data: {},
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('emits status snapshot for permitted users', async () => {
    const { gateway, jwtService, authService, queueRepo, configService, session } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 7, ver: 9 });
    authService.validateUser.mockResolvedValue({
      id: 7,
      isSuperuser: false,
      permissions: [Permission.ManageMetadataConfig],
    });
    queueRepo.getStatusSummary.mockResolvedValue({ queued: 1, processing: 2, failed: 3 });
    configService.isPaused.mockResolvedValue(true);
    session.getSnapshot.mockReturnValue({ sessionTotal: 9, sessionDone: 4, currentItemName: 'Book' });
    const client = {
      id: 'sock-3',
      handshake: { auth: { token: 'jwt' } },
      emit: vi.fn(),
      disconnect: vi.fn(),
      data: {},
    } as any;

    await gateway.handleConnection(client);

    expect(client.data.user).toEqual(expect.objectContaining({ id: 7 }));
    expect(client.emit).toHaveBeenCalledWith(BOOK_METADATA_FETCH_STATUS_EVENT, {
      queued: 1,
      processing: 2,
      failed: 3,
      paused: true,
      sessionTotal: 9,
      sessionDone: 4,
      currentItemName: 'Book',
    });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('emitStatus broadcasts event to namespace listeners', () => {
    const { gateway } = makeGateway();
    const emit = vi.fn();
    gateway.server = { emit } as any;

    gateway.emitStatus({
      queued: 1,
      processing: 0,
      failed: 0,
      paused: false,
      sessionTotal: 1,
      sessionDone: 0,
      currentItemName: null,
    });

    expect(emit).toHaveBeenCalledWith(BOOK_METADATA_FETCH_STATUS_EVENT, {
      queued: 1,
      processing: 0,
      failed: 0,
      paused: false,
      sessionTotal: 1,
      sessionDone: 0,
      currentItemName: null,
    });
  });
});
