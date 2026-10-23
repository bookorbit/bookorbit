import { READ_ALOUD_DELIVERY_VARIANTS, type ReadAloudDeliveryPreference } from '@bookorbit/types';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

const SORT_ORDER_VALUES = ['recent', 'title_asc', 'title_desc', 'author_asc', 'author_desc', 'series_asc', 'series_desc'] as const;

export class UpdateOpdsUserDto {
  @IsOptional()
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  readAloudDelivery?: ReadAloudDeliveryPreference;

  @IsOptional()
  @IsEnum(SORT_ORDER_VALUES)
  sortOrder?: (typeof SORT_ORDER_VALUES)[number];
}
