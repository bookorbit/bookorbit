import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class SelectReleaseUnitDto {
  /** Position in the held attempt's stored unit list. Bounds are checked against that list. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitIndex!: number;
}
