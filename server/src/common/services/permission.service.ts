import { Injectable } from '@nestjs/common';
import { RequestUser } from '../types/request-user';

@Injectable()
export class PermissionService {
  userHas(user: RequestUser, permissionName: string): boolean {
    const roles = Array.isArray(user?.roles) ? user.roles : [];

    for (const role of roles) {
      if (role?.isSuperuser) return true;
    }

    for (const role of roles) {
      const permissions = Array.isArray(role?.permissions) ? role.permissions : [];
      if (permissions.some((permission) => permission?.name === permissionName)) return true;
    }

    return false;
  }
}
