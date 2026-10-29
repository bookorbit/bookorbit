import { Logger } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { WS_UNAUTHORIZED_EVENT } from '../../common/utils/ws-auth.utils';
import { ReadAloudGateway } from './read-aloud.gateway';

function makeGateway(user: { id: number; isSuperuser: boolean; permissions: string[] } | null) {
  const jwtService = { verify: vi.fn().mockReturnValue({ sub: 7, ver: 1 }) };
  const authService = { validateSessionUser: vi.fn().mockResolvedValue(user) };
  const gateway = new ReadAloudGateway(jwtService as never, authService as never);
  const client = { id: 'sock-1', handshake: { auth: { token: 'jwt' } }, emit: vi.fn(), disconnect: vi.fn(), join: vi.fn() };
  return { gateway, client };
}

describe('ReadAloudGateway', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('joins the user room when the account may generate read-alongs', async () => {
    const { gateway, client } = makeGateway({ id: 7, isSuperuser: false, permissions: [Permission.LibraryGenerateReadAloud] });
    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledWith('read-aloud:user:7');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ['without the permission', { id: 7, isSuperuser: false, permissions: [] }],
    ['on a demo account', { id: 7, isSuperuser: false, permissions: [Permission.LibraryGenerateReadAloud, Permission.DemoRestricted] }],
  ])('closes silently %s, so the client does not refresh its token and retry', async (_label, user) => {
    const { gateway, client } = makeGateway(user);
    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.emit).not.toHaveBeenCalledWith(WS_UNAUTHORIZED_EVENT, expect.anything());
    expect(client.join).not.toHaveBeenCalled();
  });

  it('asks the client to re-authenticate when the session is gone', async () => {
    const { gateway, client } = makeGateway(null);
    await gateway.handleConnection(client as never);

    expect(client.emit).toHaveBeenCalledWith(WS_UNAUTHORIZED_EVENT, expect.anything());
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
