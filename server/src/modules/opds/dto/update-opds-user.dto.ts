import { IsEnum } from 'class-validator';

const SORT_ORDER_VALUES = ['recent', 'title_asc', 'title_desc', 'author_asc', 'author_desc', 'series_asc', 'series_desc'] as const;

export class UpdateOpdsUserDto {
  @IsEnum(SORT_ORDER_VALUES)
  sortOrder: (typeof SORT_ORDER_VALUES)[number];
}
