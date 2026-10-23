import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { BOOK_REQUEST_MEDIA_KINDS } from '@bookorbit/types';
import type { BookRequestMediaKind } from '@bookorbit/types';

/**
 * One provider's record of the same work, as the shared `BookRequestMetadataSource` describes it.
 *
 * Both ISBNs are stated as nullable rather than merely optional, because that is what the wire
 * actually carries: a client holding the shared type sends `isbn10: null` for an edition with no
 * ISBN-10, and `@IsOptional()` accepts null and undefined alike. `normalizeMetadataSources` is
 * what collapses the two into the null the stored shape requires.
 */
export class BookRequestMetadataSourceDto {
  @IsString()
  @MaxLength(50)
  providerKey!: string;

  @IsString()
  @MaxLength(255)
  providerId!: string;

  @IsString()
  @MaxLength(100)
  providerLabel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn10?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn13?: string | null;
}

/**
 * Everything that describes the work and who is asking for it, shared by a single request and by
 * an ebook and audiobook pair. What differs per medium - the medium itself, where it lands and
 * which formats are preferred - is declared by each subclass.
 */
export class BookRequestWorkDto {
  /**
   * File this as somebody else, for a front end that its users sign into instead of this one.
   *
   * Refused without `manage_book_requests`, and the named user's own permissions decide the rest:
   * naming them says who asked, never what they may have. Omitted, or set to the caller's own id,
   * this is an ordinary request and nothing about it changes.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @IsString()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subtitle?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  authors?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seriesName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seriesIndex?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn10?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn13?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  publishedYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }, { message: 'coverUrl must be an http or https address' })
  coverUrl?: string;

  /**
   * Ask to fulfil this one yourself instead of queueing it for an approver. Refused without
   * `book_request_self_fulfill`; never inferred from the permission, because then every ordinary
   * request its holder made would skip the queue too.
   */
  @IsOptional()
  @IsBoolean()
  selfServe?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  providerKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BookRequestMetadataSourceDto)
  metadataSources?: BookRequestMetadataSourceDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateBookRequestDto extends BookRequestWorkDto {
  @IsIn(BOOK_REQUEST_MEDIA_KINDS)
  mediaKind!: BookRequestMediaKind;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  preferredFormats?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetLibraryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetFolderId?: number;

  /**
   * The book the arriving files should join, for a format that book does not have yet. Optional
   * and new, so a client only sends it to a server advertising `book-request-pairs`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetBookId?: number;
}
