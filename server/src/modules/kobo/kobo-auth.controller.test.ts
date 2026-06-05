import { ValidationPipe } from '@nestjs/common';

import { KoboAuthController } from './kobo-auth.controller';

describe('KoboAuthController', () => {
  const controller = new KoboAuthController();
  const nativeKoboAuthPayload = {
    AffiliateName: 'Kobo',
    AppVersion: '4.45.23697',
    ClientKey: 'client-key',
    DeviceId: 'device-id',
    PlatformId: 'platform-id',
    SerialNumber: 'serial-number',
    UserKey: 'user-key-1',
  };

  it('authDevice returns fresh tokens and echoes UserKey when present', () => {
    const result = controller.authDevice(nativeKoboAuthPayload);

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

  it('authDevice falls back to empty UserKey when body is null', () => {
    const result = controller.authDevice(null);

    expect(result.UserKey).toBe('');
    expect(result.RefreshToken).toEqual(expect.any(String));
  });

  it('authRefresh preserves incoming RefreshToken when provided', () => {
    const result = controller.authRefresh({ ...nativeKoboAuthPayload, RefreshToken: 'existing-refresh' });

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

  it('authRefresh generates RefreshToken when body is null', () => {
    const result = controller.authRefresh(null);

    expect(result.RefreshToken).toEqual(expect.any(String));
    expect(result.AccessToken).toEqual(expect.any(String));
  });

  it('keeps auth bodies compatible with the global whitelist validation pipe', async () => {
    const authDeviceParamTypes = Reflect.getMetadata('design:paramtypes', KoboAuthController.prototype, 'authDevice') as unknown[];
    const authRefreshParamTypes = Reflect.getMetadata('design:paramtypes', KoboAuthController.prototype, 'authRefresh') as unknown[];
    const globalPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    expect(authDeviceParamTypes[0]).toBe(Object);
    expect(authRefreshParamTypes[0]).toBe(Object);
    await expect(globalPipe.transform(nativeKoboAuthPayload, { type: 'body', metatype: Object, data: undefined })).resolves.toEqual(
      nativeKoboAuthPayload,
    );
  });
});
