import { IsArray, IsIn, IsString } from 'class-validator';
import { BulkSelectionDto } from './bulk-selection.dto';

const TAG_MODES = ['add', 'remove', 'replace'] as const;
export type TagUpdateMode = (typeof TAG_MODES)[number];

export class BulkUpdateTagsDto extends BulkSelectionDto {
  @IsIn(TAG_MODES)
  mode!: TagUpdateMode;

  @IsArray()
  @IsString({ each: true })
  tags: string[];
}
