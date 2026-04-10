import { BookBucketGateway } from './book-bucket.gateway';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateUser: vi.fn() };
  const gateway = new BookBucketGateway(jwtService as any, authService as any);
  return { gateway, jwtService, authService };
}

describe('BookBucketGateway', () => {
  it('disconnects sockets when auth token is missing', async () => {
    const { gateway } = makeGateway();
    const client = {
      id: 'socket-1',
      handshake: { auth: {} },
      data: {},
      disconnect: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects sockets when user cannot be validated', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 8, ver: 3 });
    authService.validateUser.mockResolvedValue(null);
    const client = {
      id: 'socket-2',
      handshake: { auth: { token: 'jwt' } },
      data: {},
      disconnect: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(authService.validateUser).toHaveBeenCalledWith(8, 3);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stores validated user on socket data and keeps socket connected', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    const user = { id: 9, isSuperuser: false, permissions: [] };
    jwtService.verify.mockReturnValue({ sub: 9, ver: 4 });
    authService.validateUser.mockResolvedValue(user);
    const client = {
      id: 'socket-3',
      handshake: { auth: { token: 'jwt' } },
      data: {},
      disconnect: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(client.data.user).toEqual(user);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('emitSummary broadcasts summary payload on websocket namespace', () => {
    const { gateway } = makeGateway();
    const emit = vi.fn();
    gateway.server = { emit } as any;

    gateway.emitSummary({ pending: 2, ready: 4, error: 1, total: 7 });

    expect(emit).toHaveBeenCalledWith('book-bucket:summary', {
      pending: 2,
      ready: 4,
      error: 1,
      total: 7,
    });
  });
});
