import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsPositive, Matches } from 'class-validator';
import type { CreateReadAloudJobRequest, ReadAloudGranularity } from '@bookorbit/types';
import { READ_ALOUD_MAX_AUDIO_FILES } from '@bookorbit/types';

export class CreateReadAloudJobDto implements CreateReadAloudJobRequest {
  @IsOptional()
  @IsInt()
  epubFileId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(READ_ALOUD_MAX_AUDIO_FILES)
  @IsInt({ each: true })
  audioFileIds?: number[];

  @IsOptional()
  @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  language?: string;

  @IsOptional()
  @IsIn(['sentence', 'word'])
  granularity?: ReadAloudGranularity;

  @IsOptional()
  @IsInt()
  @IsPositive()
  replaceFileId?: number;
}
