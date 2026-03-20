import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { UserDailyReadingQueryDto } from './user-daily-reading-query.dto';

export class UserGoalTrajectoryQueryDto extends UserDailyReadingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  goalBooks?: number;
}
