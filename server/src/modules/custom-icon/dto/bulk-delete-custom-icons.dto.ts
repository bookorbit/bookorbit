import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';
import { CUSTOM_ICON_MAX_PAGE_SIZE, CUSTOM_ICON_SLUG_MAX_LENGTH } from '@bookorbit/types';

export class BulkDeleteCustomIconsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CUSTOM_ICON_MAX_PAGE_SIZE)
  @IsString({ each: true })
  @MaxLength(CUSTOM_ICON_SLUG_MAX_LENGTH, { each: true })
  slugs!: string[];
}
