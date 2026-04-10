import { KoboAuthController } from './kobo-auth.controller';

describe('KoboAuthController', () => {
  const controller = new KoboAuthController();

  it('authDevice returns fresh tokens and echoes UserKey when present', () => {
    const result = controller.authDevice({ UserKey: 'user-key-1' });

    expect(result.AccessToken).toEqual(expect.any(String));
    expect(result.RefreshToken).toEqual(expect.any(String));
    expect(result.TrackingId).toEqual(expect.any(String));
    expect(result.TokenType).toBe('Bearer');
    expect(result.UserKey).toBe('user-key-1');
  });

  it('authDevice falls back to empty UserKey when missing', () => {
    const result = controller.authDevice({});

    expect(result.UserKey).toBe('');
    expect(result.RefreshToken).toEqual(expect.any(String));
  });

  it('authRefresh preserves incoming RefreshToken when provided', () => {
    const result = controller.authRefresh({ RefreshToken: 'existing-refresh' });

    expect(result.AccessToken).toEqual(expect.any(String));
    expect(result.RefreshToken).toBe('existing-refresh');
    expect(result.TokenType).toBe('Bearer');
    expect(result.TrackingId).toEqual(expect.any(String));
  });

  it('authRefresh generates RefreshToken when request does not provide one', () => {
    const result = controller.authRefresh({});

    expect(result.RefreshToken).toEqual(expect.any(String));
    expect(result.AccessToken).toEqual(expect.any(String));
  });
});
