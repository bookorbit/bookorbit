import type { RequestUser } from '../../common/types/request-user';
import { LensController } from './lens.controller';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 12,
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

describe('LensController', () => {
  it('forwards each route handler to LensService with parsed args', async () => {
    const lensService = {
      findAll: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 1 }),
      create: vi.fn().mockResolvedValue({ id: 2 }),
      reorder: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({ id: 1, name: 'Updated' }),
      remove: vi.fn().mockResolvedValue(undefined),
      executeLens: vi.fn().mockResolvedValue({ items: [], total: 0, page: 0, size: 50 }),
    };
    const controller = new LensController(lensService as never);
    const user = makeUser();

    await controller.findAll(user);
    await controller.findOne(1, user);
    await controller.create({ name: 'New lens', icon: 'Aperture' } as never, user);
    await controller.reorder({ order: [{ id: 1, displayOrder: 0 }] } as never, user);
    await controller.update(1, { name: 'Updated' } as never, user);
    await controller.remove(1, user);
    await controller.executeLens(1, user, 2, 25);

    expect(lensService.findAll).toHaveBeenCalledWith(user);
    expect(lensService.findOne).toHaveBeenCalledWith(1, user);
    expect(lensService.create).toHaveBeenCalledWith({ name: 'New lens', icon: 'Aperture' }, user);
    expect(lensService.reorder).toHaveBeenCalledWith({ order: [{ id: 1, displayOrder: 0 }] }, user);
    expect(lensService.update).toHaveBeenCalledWith(1, { name: 'Updated' }, user);
    expect(lensService.remove).toHaveBeenCalledWith(1, user);
    expect(lensService.executeLens).toHaveBeenCalledWith(1, user, 2, 25);
  });
});
