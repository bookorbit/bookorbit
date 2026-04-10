import 'reflect-metadata';

import { AuditAction } from '@projectx/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { KoboUserController } from './kobo-user.controller';

describe('KoboUserController', () => {
  const deviceService = {
    listDevices: vi.fn(),
    createDevice: vi.fn(),
    renameDevice: vi.fn(),
    revokeDevice: vi.fn(),
  };
  const settingsService = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
  const controller = new KoboUserController(deviceService as never, settingsService as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates device operations with current user id', async () => {
    deviceService.listDevices.mockResolvedValue([{ id: 1 }]);
    deviceService.createDevice.mockResolvedValue({ id: 2, name: 'Aura' });
    deviceService.renameDevice.mockResolvedValue({ id: 2, name: 'Clara' });
    deviceService.revokeDevice.mockResolvedValue(undefined);

    await expect(controller.listDevices({ id: 7 } as never)).resolves.toEqual([{ id: 1 }]);
    await expect(controller.createDevice({ name: 'Aura' } as never, { id: 7 } as never)).resolves.toEqual({ id: 2, name: 'Aura' });
    await expect(controller.renameDevice(2, { name: 'Clara' } as never, { id: 7 } as never)).resolves.toEqual({ id: 2, name: 'Clara' });
    await expect(controller.revokeDevice(2, { id: 7 } as never)).resolves.toBeUndefined();

    expect(deviceService.listDevices).toHaveBeenCalledWith(7);
    expect(deviceService.createDevice).toHaveBeenCalledWith(7, 'Aura');
    expect(deviceService.renameDevice).toHaveBeenCalledWith(7, 2, 'Clara');
    expect(deviceService.revokeDevice).toHaveBeenCalledWith(7, 2);
  });

  it('delegates settings reads and writes with current user id', async () => {
    settingsService.getSettings.mockResolvedValue({ readingThreshold: 1.2 });
    settingsService.updateSettings.mockResolvedValue({ readingThreshold: 2 });

    await expect(controller.getSettings({ id: 5 } as never)).resolves.toEqual({ readingThreshold: 1.2 });
    await expect(controller.updateSettings({ readingThreshold: 2 } as never, { id: 5 } as never)).resolves.toEqual({
      readingThreshold: 2,
    });

    expect(settingsService.getSettings).toHaveBeenCalledWith(5);
    expect(settingsService.updateSettings).toHaveBeenCalledWith(5, { readingThreshold: 2 });
  });

  it('registers auditable metadata for create/rename/remove actions', () => {
    const createAudit = Reflect.getMetadata(AUDITABLE_KEY, KoboUserController.prototype.createDevice) as {
      action: AuditAction;
      getResourceId: (_: unknown, response: { id?: number }) => number | undefined;
      description: (req: { body: { name?: string } }) => string;
    };
    const renameAudit = Reflect.getMetadata(AUDITABLE_KEY, KoboUserController.prototype.renameDevice) as {
      action: AuditAction;
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string>; body: { name?: string } }) => string;
    };
    const removeAudit = Reflect.getMetadata(AUDITABLE_KEY, KoboUserController.prototype.revokeDevice) as {
      action: AuditAction;
      getResourceId: (req: { params: Record<string, string> }) => number;
    };

    expect(createAudit.action).toBe(AuditAction.KoboDeviceRegister);
    expect(createAudit.getResourceId({}, { id: 22 })).toBe(22);
    expect(createAudit.description({ body: { name: 'Elipsa' } })).toContain('Elipsa');

    expect(renameAudit.action).toBe(AuditAction.KoboDeviceRename);
    expect(renameAudit.getResourceId({ params: { id: '9' } })).toBe(9);
    expect(renameAudit.description({ params: { id: '9' }, body: { name: 'Libra' } })).toContain("to 'Libra'");

    expect(removeAudit.action).toBe(AuditAction.KoboDeviceRemove);
    expect(removeAudit.getResourceId({ params: { id: '44' } })).toBe(44);
  });
});
