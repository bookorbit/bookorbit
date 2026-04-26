import { Injectable } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { RequestUser } from '../types/request-user';

@Injectable()
export class PermissionService {
  userHas(user: RequestUser, permission: Permission): boolean {
    if (user?.isSuperuser) return true;
    return this.userHasExplicit(user, permission);
  }

  userHasExplicit(user: RequestUser, permission: Permission): boolean {
    return Array.isArray(user?.permissions) && user.permissions.includes(permission);
  }
}
