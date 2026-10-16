import type { EmailRecipientTestRequest } from '@bookorbit/types';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The test message comes from the client so it is written in the sender's interface language;
 * the server has no catalog for email copy.
 */
export class SendRecipientTestDto implements EmailRecipientTestRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text: string;
}
