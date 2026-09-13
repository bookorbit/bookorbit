import { Permission } from '@bookorbit/types';

import { BookRequestGateway } from './book-request.gateway';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateUser: vi.fn() };
  const gateway = new BookRequestGateway(jwtService as any, authService as any);
  return { gateway, jwtService, authService };
}

function makeClient(id = 'socket-1') {
  return {
    id,
    handshake: { auth: { token: 'jwt' } },
    data: {},
    join: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    disconnect: vi.fn(),
  } as any;
}

async function connect(user: { id: number; isSuperuser: boolean; permissions: Permission[] }) {
  const { gateway, jwtService, authService } = makeGateway();
  jwtService.verify.mockReturnValue({ sub: user.id, ver: 1 });
  authService.validateUser.mockResolvedValue(user);
  const client = makeClient();
  await gateway.handleConnection(client);
  return { gateway, client };
}

describe('BookRequestGateway', () => {
  it('rejects a socket without book request access', async () => {
    const { client } = await connect({ id: 5, isSuperuser: false, permissions: [] });

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('puts an ordinary requester in their own room only', async () => {
    const { client } = await connect({ id: 5, isSuperuser: false, permissions: [Permission.BookRequestAccess] });

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join.mock.calls.flat()).toEqual(['book-requests:user:5']);
  });

  it('puts a moderator in the managers room as well', async () => {
    const { client } = await connect({ id: 6, isSuperuser: false, permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });

    expect(client.join.mock.calls.flat()).toEqual(['book-requests:user:6', 'book-requests:managers']);
  });

  /** A progress tick names request ids and byte totals, which HTTP hands to these people only. */
  it('routes progress to the managers and the named viewers rather than broadcasting it', () => {
    const { gateway } = makeGateway();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    const serverEmit = vi.fn();
    gateway.server = { to, emit: serverEmit } as any;

    gateway.emitProgress({ requestId: 3, downloadId: 9, status: 'downloading', progressPercent: 40, downloadedBytes: 4, totalBytes: 10 }, [5, 8]);

    expect(to).toHaveBeenCalledWith(['book-requests:managers', 'book-requests:user:5', 'book-requests:user:8']);
    expect(emit).toHaveBeenCalledWith('book-requests:progress', expect.objectContaining({ requestId: 3 }));
    expect(serverEmit).not.toHaveBeenCalled();
  });

  /** The change signal carries nothing, and every page answers it with a scoped fetch. */
  it('broadcasts the change signal to every connected socket', () => {
    const { gateway } = makeGateway();
    const emit = vi.fn();
    gateway.server = { emit } as any;

    gateway.emitChanged();

    expect(emit).toHaveBeenCalledWith('book-requests:changed');
    expect(gateway.changeVersion).toBe(1);
  });
});
