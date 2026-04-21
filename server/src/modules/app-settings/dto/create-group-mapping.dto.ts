import { IsIn, IsString, MaxLength } from 'class-validator';
import { Permission } from '@bookorbit/types';

export class CreateGroupMappingDto {
  @IsString()
  @MaxLength(256)
  oidcGroupClaim: string;

  @IsIn(Object.values(Permission))
  permissionName: string;
}
