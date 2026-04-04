import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, Min } from 'class-validator';

export class CreateDryRunPlanDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  profileId!: number;

  @IsOptional()
  @IsObject()
  scopeOverride?: Record<string, unknown>;
}
