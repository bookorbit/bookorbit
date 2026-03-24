import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ComicMetadataDto {
  @IsOptional() @IsString() @MaxLength(50) issueNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(500) volumeName?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) pencillers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) inkers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) colorists?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) letterers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) coverArtists?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) characters?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) teams?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) locations?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) storyArcs?: string[];
}

export class UpdateBookMetadataDto {
  @IsOptional() @IsString() @MaxLength(1000) title?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) subtitle?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() @MaxLength(500) publisher?: string | null;
  @IsOptional() @IsInt() @Min(1) publishedYear?: number | null;
  @IsOptional() @IsString() @MaxLength(10) language?: string | null;
  @IsOptional() @IsInt() @Min(1) pageCount?: number | null;
  @IsOptional() @IsString() @MaxLength(500) seriesName?: string | null;
  @IsOptional() @IsNumber() seriesIndex?: number | null;
  @IsOptional() @IsString() @MaxLength(13) isbn10?: string | null;
  @IsOptional() @IsString() @MaxLength(13) isbn13?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) authors?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) narrators?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(50) googleBooksId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) goodreadsId?: string | null;
  @IsOptional() @IsString() @MaxLength(20) amazonId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) hardcoverId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) openLibraryId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) itunesId?: string | null;
  @IsOptional() @IsString() @MaxLength(20) audibleId?: string | null;
  @IsOptional() @IsInt() @Min(0) durationSeconds?: number | null;
  @IsOptional() @IsBoolean() abridged?: boolean | null;
  @IsOptional() @IsString() @MaxLength(50) comicvineId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => ComicMetadataDto) comicMetadata?: ComicMetadataDto;
}
