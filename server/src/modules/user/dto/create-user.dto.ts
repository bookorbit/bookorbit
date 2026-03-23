import { IsArray, IsEmail, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

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
  @IsString({ each: true })
  @IsOptional()
  permissionNames?: string[];

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  libraryIds?: number[];
}
