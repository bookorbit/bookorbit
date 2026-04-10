import { OpdsUserController } from './opds-user.controller';

describe('OpdsUserController', () => {
  it('delegates CRUD operations to OpdsUserService with current user scoping', async () => {
    const service = {
      findAllForUser: vi.fn().mockResolvedValue('all'),
      create: vi.fn().mockResolvedValue('created'),
      update: vi.fn().mockResolvedValue('updated'),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new OpdsUserController(service as never);
    const user = { id: 5 } as never;

    await expect(controller.findAll(user)).resolves.toBe('all');
    await expect(controller.create(user, { username: 'reader', password: 'password123' } as never)).resolves.toBe('created');
    await expect(controller.update(user, 11, { sortOrder: 'title_asc' } as never)).resolves.toBe('updated');
    await expect(controller.delete(user, 11)).resolves.toBeUndefined();

    expect(service.findAllForUser).toHaveBeenCalledWith(5);
    expect(service.create).toHaveBeenCalledWith(5, { username: 'reader', password: 'password123' });
    expect(service.update).toHaveBeenCalledWith(5, 11, { sortOrder: 'title_asc' });
    expect(service.delete).toHaveBeenCalledWith(5, 11);
  });
});
