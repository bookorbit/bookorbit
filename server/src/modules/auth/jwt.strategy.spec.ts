import { UnauthorizedException } from '@nestjs/common';

import { JwtStrategy } from './jwt.strategy';

function makeStrategy() {
  const authService = {
    validateUser: jest.fn(),
  };
  const config = {
    get: jest.fn().mockReturnValue('test-jwt-secret'),
  };

  // Bypass PassportStrategy super() call
  const strategy = Object.create(JwtStrategy.prototype) as JwtStrategy;
  (strategy as never as { authService: unknown }).authService = authService;

  return { strategy, authService, config };
}

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
