import { Injectable } from '@nestjs/common';
import { Permission } from '@projectx/types';

@Injectable()
export class RoleService {
  findAllPermissions(): Permission[] {
    return Object.values(Permission);
  }
}
