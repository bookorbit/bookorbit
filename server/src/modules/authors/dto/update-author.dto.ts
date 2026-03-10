import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAuthorDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sortName?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;
}
