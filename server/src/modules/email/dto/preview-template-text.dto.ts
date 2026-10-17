import type { EmailTemplateTextPreviewRequest } from '@bookorbit/types';
import { IsInt, IsString, MaxLength } from 'class-validator';

/** A template that has not been saved yet, rendered against one book for the editor's preview. */
export class PreviewTemplateTextDto implements EmailTemplateTextPreviewRequest {
  @IsString()
  @MaxLength(998)
  subject: string;

  @IsString()
  @MaxLength(200_000)
  bodyText: string;

  @IsInt()
  bookId: number;
}
