import { IsIn } from 'class-validator';
import { Permission } from '@bookorbit/types';

export class UpdateGroupMappingDto {
  @IsIn(Object.values(Permission))
  permissionName: string;
}
