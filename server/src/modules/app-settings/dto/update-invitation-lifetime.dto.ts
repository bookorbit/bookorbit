import { IsIn } from 'class-validator';
import { INVITATION_LIFETIMES_MINUTES, type InvitationLifetimeMinutes, type InvitationLifetimeSetting } from '@bookorbit/types';

export class UpdateInvitationLifetimeDto implements InvitationLifetimeSetting {
  @IsIn(INVITATION_LIFETIMES_MINUTES)
  minutes!: InvitationLifetimeMinutes;
}
