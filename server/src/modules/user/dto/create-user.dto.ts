import { Permission } from '@bookorbit/types';
import { IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
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
