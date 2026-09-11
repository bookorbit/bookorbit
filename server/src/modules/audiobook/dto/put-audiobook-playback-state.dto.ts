import { IsISO8601, IsInt, IsString, IsUUID, Matches, Min } from 'class-validator';

export class PutAudiobookPlaybackStateDto {
  @IsString()
  @Matches(/^aud_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assetId!: string;

  @IsInt()
  @Min(0)
  positionMs!: number;

  @IsISO8601({ strict: true })
  capturedAt!: string;

  @IsUUID()
  operationId!: string;

  @IsInt()
  @Min(0)
  baseRevision!: number;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  manifestRevision!: string;
}
