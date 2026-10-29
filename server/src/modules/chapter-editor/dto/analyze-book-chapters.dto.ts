import { CHAPTER_PAUSE_LIMITS, type AnalyzeBookChaptersRequest } from '@bookorbit/types';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AnalyzeBookChaptersDto implements AnalyzeBookChaptersRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CHAPTER_PAUSE_LIMITS.maxPoints)
  @IsInt({ each: true })
  @Min(0, { each: true })
  points!: number[];

  @IsOptional()
  @IsInt()
  @Min(CHAPTER_PAUSE_LIMITS.minWindowMs)
  @Max(CHAPTER_PAUSE_LIMITS.maxWindowMs)
  windowMs?: number;
}
