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
  @MaxLength(10_000)
  description?: string | null;
}
