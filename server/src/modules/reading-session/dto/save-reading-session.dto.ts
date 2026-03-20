import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SaveReadingSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sessionId!: string;

  @IsDateString()
  startedAt!: string;

  @IsDateString()
  endedAt!: string;

  // Client-computed from active reading time (excludes idle and tab-hidden periods).
  // Server validates it does not exceed the wall-clock span of the session.
  @IsInt()
  @Min(0)
  durationSeconds!: number;

  // Nullable: can be negative if the user navigated backward.
  @IsOptional()
  @IsNumber()
  progressDelta?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  endProgress?: number | null;
}
