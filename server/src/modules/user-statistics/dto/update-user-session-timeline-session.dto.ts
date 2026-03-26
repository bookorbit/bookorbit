import { IsDateString } from 'class-validator';

export class UpdateUserSessionTimelineSessionDto {
  @IsDateString()
  startedAt!: string;

  @IsDateString()
  endedAt!: string;
}
