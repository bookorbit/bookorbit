import { Permission } from '@projectx/types';
import { IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsArray()
  @IsEnum(Permission, { each: true })
  @IsOptional()
  permissionNames?: Permission[];

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  libraryIds?: number[];
}
