import { Permission, RESTRICTIVE_PERMISSIONS } from '@bookorbit/types';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsNotIn } from 'class-validator';

export class UpdateStartingPermissionsDto {
  @IsArray()
  @ArrayMaxSize(Object.values(Permission).length)
  @ArrayUnique()
  @IsEnum(Permission, { each: true })
  @IsNotIn([...RESTRICTIVE_PERMISSIONS], { each: true })
  permissionNames: Permission[];
}
