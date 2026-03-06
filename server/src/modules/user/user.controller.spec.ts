import { UserController } from './user.controller';

describe('UserController', () => {
  const userService = {
    findAll: jest.fn(),
    updateMe: jest.fn(),
    findById: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
    assignRole: jest.fn(),
    revokeRole: jest.fn(),
    adminResetPassword: jest.fn(),
  };

  const controller = new UserController(userService as any);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('passes optional pagination args to service', () => {
    controller.findAll(undefined, 25);
    expect(userService.findAll).toHaveBeenCalledWith(undefined, 25);
  });

  it('routes updateMe to current user id', () => {
    const user = { id: 7 } as any;
    const dto = { name: 'Updated' };

    controller.updateMe(user, dto as any);

    expect(userService.updateMe).toHaveBeenCalledWith(7, dto);
  });

  it('delegates role assignment/revocation and admin reset', () => {
    const requester = { id: 1 } as any;

    controller.assignRole(8, { roleId: 4 } as any, requester);
    controller.revokeRole(8, 4, requester);
    controller.adminResetPassword(8, requester);

    expect(userService.assignRole).toHaveBeenCalledWith(8, 4, requester);
    expect(userService.revokeRole).toHaveBeenCalledWith(8, 4, requester);
    expect(userService.adminResetPassword).toHaveBeenCalledWith(8, requester);
  });
});
