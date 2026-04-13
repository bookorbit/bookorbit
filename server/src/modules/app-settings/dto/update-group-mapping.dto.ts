import { IsIn } from 'class-validator';
import { Permission } from '@projectx/types';

export class UpdateGroupMappingDto {
  @IsIn(Object.values(Permission))
  permissionName: string;
}
