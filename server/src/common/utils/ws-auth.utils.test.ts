import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';

import { rejectSocketConnection, WS_UNAUTHORIZED_EVENT } from './ws-auth.utils';

function makeClient() {
  const order: string[] = [];
  return {
    emit: vi.fn(() => order.push('emit')),
    disconnect: vi.fn(() => order.push('disconnect')),
    order,
  };
}

/** jsonwebtoken's errors, reproduced by shape so the test does not depend on the package. */
function jwtError(name: 'TokenExpiredError' | 'JsonWebTokenError' | 'NotBeforeError', message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('rejectSocketConnection', () => {
  it.each(['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError'] as const)('invites a retry when JwtService rejects with %s', (name) => {
    const client = makeClient();

    rejectSocketConnection(client as unknown as Socket, jwtError(name, 'jwt expired'));

    expect(client.emit).toHaveBeenCalledWith(WS_UNAUTHORIZED_EVENT, { reason: 'invalid_token' });
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('tells the client to re-authenticate when the token was the problem', () => {
    const client = makeClient();

    rejectSocketConnection(client as unknown as Socket, new UnauthorizedException('jwt expired'));

    expect(client.emit).toHaveBeenCalledWith(WS_UNAUTHORIZED_EVENT, { reason: 'invalid_token' });
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('sends the reason before closing, or the client never receives it', () => {
    const client = makeClient();

    rejectSocketConnection(client as unknown as Socket, new UnauthorizedException('no token'));

    expect(client.order).toEqual(['emit', 'disconnect']);
  });

  it('closes silently on a permission denial, which a fresh token would not fix', () => {
    const client = makeClient();

    rejectSocketConnection(client as unknown as Socket, new ForbiddenException('Missing permission: notification_access'));

    expect(client.emit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes silently on an unexpected failure rather than inviting a reconnect loop', () => {
    const client = makeClient();

    rejectSocketConnection(client as unknown as Socket, new BadRequestException('boom'));
    rejectSocketConnection(client as unknown as Socket, new Error('database unavailable'));

    expect(client.emit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(2);
  });
});
