import { Type } from 'class-transformer';
import { IsBase64, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { MAX_INDEXER_RELEASE_GUID_LENGTH } from '@bookorbit/types';

/** The longest base64 `.torrent` the grab takes. The 2 MiB the service accepts is about 2.7 Mi characters. */
export const GRAB_TORRENT_BASE64_MAX_LENGTH = 4 * 1024 * 1024;

/**
 * The grab routes' body limit. Fastify's default is 1 MiB, which refused a `.torrent` over about
 * 768 KiB with a 413 before this DTO was read, though the DTO and the service allow far more.
 */
export const GRAB_BODY_LIMIT_BYTES = GRAB_TORRENT_BASE64_MAX_LENGTH + 1024 * 1024;

/**
 * A grab names one of three things: a release the approver picked out of the ranked list, a
 * magnet, or a .torrent file. The service enforces "exactly one", because none of them is
 * required on its own.
 *
 * A picked release is named by indexer and guid, never by URL. The server resolves the download
 * link from its own search results, so a client cannot point the download client at an address it
 * chose, and a private tracker's credentialed link never has to leave the server.
 *
 * A .torrent arrives base64-encoded in the JSON body rather than as multipart. Torrent files are
 * a few kilobytes, and one JSON endpoint keeps every path validated the same way.
 */
export class GrabBookRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  indexerId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_INDEXER_RELEASE_GUID_LENGTH)
  releaseGuid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  magnet?: string;

  @IsOptional()
  @IsBase64()
  @MaxLength(GRAB_TORRENT_BASE64_MAX_LENGTH)
  torrentFileBase64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  torrentFileName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  downloadClientId?: number;

  /**
   * Wait in review once the download lands, whatever the verification score. Advertised as the
   * `book-request-review-hold` server feature, because a server older than the field rejects it.
   */
  @IsOptional()
  @IsBoolean()
  holdForReview?: boolean;
}
