import type { EmailSendOptions } from '@bookorbit/types';
import { IsArray, IsInt, IsOptional } from 'class-validator';

import { BulkSelectionDto } from '../../../common/dto/bulk-selection.dto';

export class SendBookDto extends BulkSelectionDto implements EmailSendOptions {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  recipientIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  groupIds?: number[];

  @IsOptional()
  @IsInt()
  fileId?: number;

  @IsOptional()
  @IsInt()
  providerId?: number;

  @IsOptional()
  @IsInt()
  templateId?: number;
}
