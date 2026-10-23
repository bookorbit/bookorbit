import { IsIn } from 'class-validator';
import { READ_ALOUD_DELIVERY_VARIANTS, type ReadAloudDeliveryVariant } from '@bookorbit/types';

export class KoboReplacementDto {
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  variant: ReadAloudDeliveryVariant;
}
