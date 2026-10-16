import type { EmailRecipientGroupMemberRequest } from '@bookorbit/types';
import { IsInt } from 'class-validator';

export class AddGroupMemberDto implements EmailRecipientGroupMemberRequest {
  @IsInt()
  recipientId: number;
}
