import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ReleaseSearchOverrides } from '@bookorbit/types';

export class SearchBookRequestReleasesDto implements ReleaseSearchOverrides {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  authors?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  preferredFormats?: string[];
}
