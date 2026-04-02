import { Permission } from '@projectx/types';
import { IsArray, IsEnum } from 'class-validator';

export class SetPermissionsDto {
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissionNames: Permission[];
}
