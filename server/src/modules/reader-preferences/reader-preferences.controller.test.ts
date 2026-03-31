import type { Mocked } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { ReaderPreferencesController } from './reader-preferences.controller';
import { ReaderPreferencesService } from './reader-preferences.service';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 7,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  };
}

describe('ReaderPreferencesController', () => {
  let service: Mocked<ReaderPreferencesService>;
  let controller: ReaderPreferencesController;

  beforeEach(() => {
    service = {
      getPreference: vi.fn(),
      upsertPreference: vi.fn(),
      deletePreference: vi.fn(),
      getAllDefaults: vi.fn(),
      upsertDefault: vi.fn(),
      deleteDefault: vi.fn(),
    } as unknown as Mocked<ReaderPreferencesService>;

    controller = new ReaderPreferencesController(service);
  });

  it('returns null settings with isCustomized=false when no per-book preference exists', async () => {
    service.getPreference.mockResolvedValueOnce(null as never);

    const result = await controller.getPreference(9, makeUser({ id: 11 }));

    expect(service.getPreference).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), 9);
    expect(result).toEqual({ settings: null, isCustomized: false });
  });

  it('returns settings with isCustomized=true when per-book preference exists', async () => {
    const settings = { zoomMode: 'fit-width' };
    service.getPreference.mockResolvedValueOnce({ settings } as never);

    const result = await controller.getPreference(9, makeUser());

    expect(result).toEqual({ settings, isCustomized: true });
  });

  it('delegates per-book upsert to service', async () => {
    const user = makeUser({ id: 15 });
    const dto = { settings: { customScale: 1.2 } };

    await controller.upsertPreference(5, dto, user);

    expect(service.upsertPreference).toHaveBeenCalledWith(user, 5, dto.settings);
  });

  it('delegates per-book delete to service', async () => {
    const user = makeUser({ id: 15 });

    await controller.deletePreference(5, user);

    expect(service.deletePreference).toHaveBeenCalledWith(user, 5);
  });

  it('returns defaults as a format-group keyed map', async () => {
    service.getAllDefaults.mockResolvedValueOnce([
      { formatGroup: 'pdf', settings: { zoomMode: 'fit-page' } },
      { formatGroup: 'audio', settings: { volume: 0.8 } },
    ] as never);

    const result = await controller.getAllDefaults(makeUser({ id: 3 }));

    expect(service.getAllDefaults).toHaveBeenCalledWith(3);
    expect(result).toEqual({
      pdf: { zoomMode: 'fit-page' },
      audio: { volume: 0.8 },
    });
  });

  it('delegates default upsert to service', async () => {
    const dto = { settings: { scrollMode: 'page', spread: 'none', zoomMode: 'fit-page', customScale: 1, rotation: 0 } };

    await controller.upsertDefault('pdf', dto, makeUser({ id: 55 }));

    expect(service.upsertDefault).toHaveBeenCalledWith(55, 'pdf', dto.settings);
  });

  it('delegates default delete to service', async () => {
    await controller.deleteDefault('pdf', makeUser({ id: 55 }));

    expect(service.deleteDefault).toHaveBeenCalledWith(55, 'pdf');
  });
});
