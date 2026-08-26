import { Type } from 'class-transformer';
import { IsBase64, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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
  @MaxLength(500)
  releaseGuid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  magnet?: string;

  @IsOptional()
  @IsBase64()
  @MaxLength(4 * 1024 * 1024)
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
}
