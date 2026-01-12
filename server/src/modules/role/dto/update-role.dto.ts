import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateRoleDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;
}
