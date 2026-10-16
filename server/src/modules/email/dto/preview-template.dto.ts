import type { EmailTemplatePreviewRequest } from '@bookorbit/types';
import { IsInt } from 'class-validator';

export class PreviewTemplateDto implements EmailTemplatePreviewRequest {
  @IsInt()
  bookId: number;
}
