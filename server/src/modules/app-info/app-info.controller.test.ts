import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import type { AppInfoResponse } from '@bookorbit/types';

import { APP_INFO_ROUTE } from './app-info.constants';
import { AppInfoController } from './app-info.controller';
import { AppInfoService } from './app-info.service';

function makeService(): jest.Mocked<AppInfoService> {
  return {
    getAppInfo: vi.fn(),
    onApplicationBootstrap: vi.fn(),
  } as unknown as jest.Mocked<AppInfoService>;
}

describe('AppInfoController', () => {
  it('keeps the expected route contract for the app-info endpoint', () => {
    const classPath = Reflect.getMetadata(PATH_METADATA, AppInfoController);
    const methodType = Reflect.getMetadata(METHOD_METADATA, AppInfoController.prototype.getAppInfo);

    expect(classPath).toBe(APP_INFO_ROUTE);
    expect(methodType).toBe(RequestMethod.GET);
  });

  describe('getAppInfo', () => {
    it('delegates to the service and returns the result', async () => {
      const service = makeService();
      const expected: AppInfoResponse = {
        version: 'v1.2.3',
        updateAvailable: true,
        latestVersion: 'v1.3.0',
      };
      service.getAppInfo.mockResolvedValue(expected);
      const controller = new AppInfoController(service);

      const result = await controller.getAppInfo();

      expect(result).toEqual(expected);
      expect(service.getAppInfo).toHaveBeenCalledOnce();
    });

    it('returns updateAvailable: null when service returns null', async () => {
      const service = makeService();
      const expected: AppInfoResponse = { version: 'Local build', updateAvailable: null, latestVersion: null };
      service.getAppInfo.mockResolvedValue(expected);
      const controller = new AppInfoController(service);

      expect(await controller.getAppInfo()).toEqual(expected);
    });
  });
});
