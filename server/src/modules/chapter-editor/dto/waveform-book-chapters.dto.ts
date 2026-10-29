import { CHAPTER_WAVEFORM_LIMITS } from '@bookorbit/types';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class WaveformBookChaptersDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  atMs!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CHAPTER_WAVEFORM_LIMITS.minWindowMs)
  @Max(CHAPTER_WAVEFORM_LIMITS.maxWindowMs)
  windowMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CHAPTER_WAVEFORM_LIMITS.minBuckets)
  @Max(CHAPTER_WAVEFORM_LIMITS.maxBuckets)
  buckets?: number;
}
