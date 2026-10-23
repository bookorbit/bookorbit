import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';

import type { RequestUser } from '../types/request-user';
import { rejectSocketConnection, resolveSocketUser, trackSocketHandshake, WS_UNAUTHORIZED_EVENT } from './ws-auth.utils';

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

describe('resolveSocketUser', () => {
  const reader = { id: 42, username: 'reader', isSuperuser: false } as RequestUser;

  function socket(data: Record<string, unknown> = {}): Socket {
    return { data } as unknown as Socket;
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('waits for a handshake that is still checking the token instead of reporting an anonymous socket', async () => {
    const client = socket();
    const handshake = deferred<RequestUser | null>();
    void trackSocketHandshake(client, handshake.promise);

    let settled = false;
    const resolved = resolveSocketUser(client).then((user) => {
      settled = true;
      return user;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    handshake.resolve(reader);
    await expect(resolved).resolves.toBe(reader);
  });

  it('reports no user when the handshake refused the socket', async () => {
    const client = socket();
    await trackSocketHandshake(client, Promise.resolve(null));

    await expect(resolveSocketUser(client)).resolves.toBeNull();
  });

  it('keeps each socket to its own handshake', async () => {
    const accepted = socket();
    const refused = socket();
    void trackSocketHandshake(accepted, Promise.resolve(reader));
    void trackSocketHandshake(refused, Promise.resolve(null));

    await expect(resolveSocketUser(accepted)).resolves.toBe(reader);
    await expect(resolveSocketUser(refused)).resolves.toBeNull();
  });

  it('falls back to the user stored on the socket when no handshake was tracked', async () => {
    await expect(resolveSocketUser(socket({ user: reader }))).resolves.toBe(reader);
    await expect(resolveSocketUser(socket())).resolves.toBeNull();
  });
});
