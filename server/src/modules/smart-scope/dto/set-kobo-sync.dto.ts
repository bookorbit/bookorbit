import { IsBoolean } from 'class-validator';

export class SetKoboSyncDto {
  @IsBoolean()
  enabled: boolean;
}
