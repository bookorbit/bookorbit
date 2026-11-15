import { Permission } from '@bookorbit/types';

import { BookRequestGateway } from './book-request.gateway';
import { AuthenticatorService } from '../auth/authenticator.service';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateSessionUser: vi.fn() };
  const jobChanges = { notify: vi.fn() };
  const gateway = new BookRequestGateway(new AuthenticatorService(jwtService as never, authService as never) as any, jobChanges as never);
  return { gateway, jwtService, authService, jobChanges };
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
  authService.validateSessionUser.mockResolvedValue(user);
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

  it('tells the Jobs area that request downloads changed state', () => {
    const { gateway, jobChanges } = makeGateway();

    gateway.emitChanged();

    expect(jobChanges.notify).toHaveBeenCalledWith({ type: 'request-download', ownerId: null, state: true });
  });

  it('hands an ordinary progress tick to the Jobs area as progress for each viewer', () => {
    const { gateway, jobChanges } = makeGateway();
    gateway.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as any;

    gateway.emitProgress({ requestId: 3, downloadId: 9, status: 'downloading', progressPercent: 40, downloadedBytes: 4, totalBytes: 10 }, [5, 8]);

    expect(jobChanges.notify.mock.calls.map(([change]) => change)).toEqual([
      { type: 'request-download', ownerId: 5, state: false },
      { type: 'request-download', ownerId: 8, state: false },
    ]);
  });

  it('hands a tick that changed the status to the Jobs area as one state change', () => {
    const { gateway, jobChanges } = makeGateway();
    gateway.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as any;

    gateway.emitProgress(
      { requestId: 3, downloadId: 9, status: 'completed', progressPercent: 100, downloadedBytes: 10, totalBytes: 10 },
      [5, 8],
      true,
    );

    expect(jobChanges.notify).toHaveBeenCalledTimes(1);
    expect(jobChanges.notify).toHaveBeenCalledWith({ type: 'request-download', ownerId: null, state: true });
  });
});
