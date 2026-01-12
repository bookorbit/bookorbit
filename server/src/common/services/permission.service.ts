import { Injectable } from '@nestjs/common';
import { RequestUser } from '../types/request-user';

@Injectable()
export class PermissionService {
  userHas(user: RequestUser, permissionName: string): boolean {
    for (const role of user.roles) {
      if (role.isSuperuser) return true;
    }
    return user.roles.flatMap((r) => r.permissions.map((p) => p.name)).includes(permissionName);
  }
}
