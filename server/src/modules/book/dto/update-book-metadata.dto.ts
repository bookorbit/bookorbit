import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { SERIES_INDEX_MAX_LENGTH, SERIES_INDEX_PATTERN, type MetadataProviderKey, type SeriesIndex } from '@bookorbit/types';
import { IsExternalProviderMap } from '../../../common/decorators/is-external-provider-map.decorator';
import { IsMetadataProviderKey } from '../../../common/decorators/is-metadata-provider-key.decorator';
import { MAX_SERIES_TOTAL_BOOKS } from '../../../common/utils/series-total-books.utils';
import { PROVIDER_ID_MAX_LENGTHS } from '../../../common/utils/provider-id.utils';
import { NormalizeIdentifier } from '../../../common/decorators/normalize-identifier.decorator';
import { CustomMetadataValueDto } from '../../custom-metadata/dto/custom-metadata-value.dto';

export class AudiobookChapterDto {
  @IsString() title!: string;
  @IsInt() @Min(0) startMs!: number;
  @IsOptional() @IsInt() @Min(0) durationMs?: number | null;
}

export class AudioMetadataDto {
  @IsOptional() @IsArray() @IsString({ each: true }) narrators?: string[];
  @IsOptional() @IsInt() @Min(0) durationSeconds?: number | null;
  @IsOptional() @IsBoolean() abridged?: boolean | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AudiobookChapterDto) chapters?: AudiobookChapterDto[] | null;
}

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

export class BookSeriesMembershipDto {
  @IsString() @MaxLength(500) seriesName!: string;
  @IsOptional() @IsString() @MaxLength(SERIES_INDEX_MAX_LENGTH) @Matches(SERIES_INDEX_PATTERN) seriesIndex?: SeriesIndex | null;
  // Series-level rather than book-level: writing it changes the total for every book in the
  // series and for every user. Bounds mirror the book_series range constraint.
  @IsOptional() @IsInt() @Min(1) @Max(MAX_SERIES_TOTAL_BOOKS) expectedBookCount?: number | null;
}

const MAX_EXTERNAL_PROVIDER_ID_LENGTH = 512;
const MAX_EXTERNAL_PROVIDER_LINK_LENGTH = 2048;

export class CommunityRatingDto {
  // Any provider key, not only built-ins: released iOS builds send back every rating they were
  // given, including an external provider's, whenever one rating changes.
  @IsMetadataProviderKey() provider!: MetadataProviderKey;
  @IsNumber() @Min(0) @Max(5) rating!: number;
  @IsOptional() @IsInt() @Min(0) ratingCount?: number | null;
}

export class UpdateBookMetadataDto {
  @IsOptional() @IsString() @MaxLength(1000) title?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) subtitle?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() @MaxLength(500) publisher?: string | null;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) publishedDate?: string | null;
  @IsOptional() @IsInt() @Min(1000) @Max(2200) publishedYear?: number | null;
  @IsOptional() @IsString() @MaxLength(100) language?: string | null;
  // A provider page count of 0 (e.g. Google Books returns 0 when unknown) means "unknown"; normalize it to null instead of rejecting it (issue #329).
  @IsOptional() @Transform(({ value }) => (value === 0 ? null : value)) @IsInt() @Min(1) pageCount?: number | null;
  @IsOptional() @IsString() @MaxLength(500) seriesName?: string | null;
  @IsOptional() @IsString() @MaxLength(SERIES_INDEX_MAX_LENGTH) @Matches(SERIES_INDEX_PATTERN) seriesIndex?: SeriesIndex | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BookSeriesMembershipDto) seriesMemberships?: BookSeriesMembershipDto[] | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(10) isbn10?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(13) isbn13?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CommunityRatingDto) communityRatings?: CommunityRatingDto[] | null;
  @IsOptional() @IsArray() @IsString({ each: true }) authors?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.googleBooksId) googleBooksId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.goodreadsId) goodreadsId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.amazonId) amazonId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.hardcoverId) hardcoverId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.hardcoverEditionId) hardcoverEditionId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.openLibraryId) openLibraryId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.itunesId) itunesId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.audibleId) audibleId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.librofmId) librofmId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.koboId) koboId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => AudioMetadataDto) audioMetadata?: AudioMetadataDto;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.comicvineId) comicvineId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.ranobedbId) ranobedbId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.lubimyczytacId) lubimyczytacId?: string | null;
  @NormalizeIdentifier() @IsOptional() @IsString() @MaxLength(PROVIDER_ID_MAX_LENGTHS.aladinId) aladinId?: string | null;
  /** Ids from external providers, keyed by provider. Null clears one; an absent key is left alone. */
  @IsOptional()
  @IsExternalProviderMap(MAX_EXTERNAL_PROVIDER_ID_LENGTH)
  externalProviderIds?: Partial<Record<string, string | null>>;
  /** The record page each external id was taken from, for the book page's links. */
  @IsOptional()
  @IsExternalProviderMap(MAX_EXTERNAL_PROVIDER_LINK_LENGTH)
  externalProviderLinks?: Partial<Record<string, string | null>>;
  @IsOptional() @ValidateNested() @Type(() => ComicMetadataDto) comicMetadata?: ComicMetadataDto;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CustomMetadataValueDto) customMetadata?: CustomMetadataValueDto[];
}
