import { UnauthorizedException } from '@nestjs/common';

import { JwtStrategy } from './jwt.strategy';

function makeStrategy() {
  const authService = {
    validateUser: vi.fn(),
  };
  const config = {
    get: vi.fn().mockReturnValue('test-jwt-secret'),
  };

  const strategy = new JwtStrategy(config as never, authService as never);

  return { strategy, authService, config };
}

describe('JwtStrategy token extraction', () => {
  it('SEC-025: accepts only HS256 algorithm (algorithm pinning)', () => {
    const { strategy } = makeStrategy();
    const verifyOptions = (strategy as unknown as { _secretOrKey?: unknown; _verifOpts?: { algorithms?: string[] } })._verifOpts;
    expect(verifyOptions?.algorithms).toEqual(['HS256']);
  });

  it('extracts token from Authorization bearer header', () => {
    const { strategy } = makeStrategy();
    const extractor = (strategy as unknown as { _jwtFromRequest: (req: unknown) => string | null })._jwtFromRequest;

    expect(extractor({ headers: { authorization: 'Bearer header-token' } })).toBe('header-token');
  });

  it('extracts token from access_token cookie', () => {
    const { strategy } = makeStrategy();
    const extractor = (strategy as unknown as { _jwtFromRequest: (req: unknown) => string | null })._jwtFromRequest;

    expect(extractor({ headers: {}, cookies: { access_token: 'cookie-token' } })).toBe('cookie-token');
  });

  it('does not extract token from query parameters', () => {
    const { strategy } = makeStrategy();
    const extractor = (strategy as unknown as { _jwtFromRequest: (req: unknown) => string | null })._jwtFromRequest;

    expect(extractor({ headers: {}, query: { token: 'query-token' } })).toBeNull();
  });
});

describe('JwtStrategy.validate', () => {
  it('returns user when validation passes', async () => {
    const { strategy, authService } = makeStrategy();
    const user = { id: 1, username: 'jdoe' };
    authService.validateUser.mockResolvedValue(user);

    const result = await strategy.validate({ sub: 1, ver: 2 });
    expect(result).toEqual(user);
    expect(authService.validateUser).toHaveBeenCalledWith(1, 2);
  });

  it('throws UnauthorizedException when validateUser returns null', async () => {
    const { strategy, authService } = makeStrategy();
    authService.validateUser.mockResolvedValue(null);

    await expect(strategy.validate({ sub: 1, ver: 1 })).rejects.toThrow(UnauthorizedException);
  });

  it('propagates UnauthorizedException from validateUser', async () => {
    const { strategy, authService } = makeStrategy();
    authService.validateUser.mockRejectedValue(new UnauthorizedException());

    await expect(strategy.validate({ sub: 1, ver: 1 })).rejects.toThrow(UnauthorizedException);
  });
});
