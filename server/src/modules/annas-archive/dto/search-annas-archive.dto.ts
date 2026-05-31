import { IsOptional, IsString, MinLength } from 'class-validator';

export class SearchAnnasArchiveDto {
  @IsString()
  @MinLength(2)
  q!: string;

  @IsOptional()
  @IsString()
  ext?: string;

  @IsOptional()
  @IsString()
  lang?: string;
}
