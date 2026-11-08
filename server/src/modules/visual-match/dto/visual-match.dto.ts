import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

import { VISUAL_MATCH_MAX_LINE_LENGTH, VISUAL_MATCH_MAX_LINES, type VisualMatchRequest } from '@bookorbit/types';

export class VisualMatchDto implements VisualMatchRequest {
  @IsArray()
  @ArrayMaxSize(VISUAL_MATCH_MAX_LINES)
  @IsString({ each: true })
  @MaxLength(VISUAL_MATCH_MAX_LINE_LENGTH, { each: true })
  lines!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn?: string | null;
}
