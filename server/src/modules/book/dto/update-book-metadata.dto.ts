import { IsArray, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
  @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(50) googleBooksId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) goodreadsId?: string | null;
  @IsOptional() @IsString() @MaxLength(20) amazonId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) hardcoverId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) openLibraryId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) itunesId?: string | null;
}
