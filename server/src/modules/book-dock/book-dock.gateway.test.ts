import { BookDockGateway } from './book-dock.gateway';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateUser: vi.fn() };
  const gateway = new BookDockGateway(jwtService as any, authService as any);
  return { gateway, jwtService, authService };
}

describe('BookDockGateway', () => {
  it('disconnects sockets when auth token is missing', async () => {
    const { gateway } = makeGateway();
    const client = {
      id: 'socket-1',
      handshake: { auth: {} },
      data: {},
      emit: vi.fn(),
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
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(authService.validateUser).toHaveBeenCalledWith(8, 3, 'legacy');
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
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(client.data.user).toEqual(user);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('broadcasts an invalidation event without leaking a global summary', () => {
    const { gateway } = makeGateway();
    const emit = vi.fn();
    gateway.server = { emit } as any;

    gateway.emitChanged();

    expect(emit).toHaveBeenCalledWith('book-dock:changed');
  });
});
