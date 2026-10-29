import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchFoldersQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  path?: string;

  /** "true" also searches the operating-system folders under `/`. */
  @IsOptional()
  @IsIn(['true', 'false'])
  system?: string;
}
