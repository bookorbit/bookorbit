import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsString } from 'class-validator';

const TAG_MODES = ['add', 'remove', 'replace'] as const;
export type TagUpdateMode = (typeof TAG_MODES)[number];

export class BulkUpdateTagsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  bookIds: number[];

  @IsIn(TAG_MODES)
  mode!: TagUpdateMode;

  @IsArray()
  @IsString({ each: true })
  tags: string[];
}
