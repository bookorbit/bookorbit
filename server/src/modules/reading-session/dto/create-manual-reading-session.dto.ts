import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateManualReadingSessionDto {
  @IsDateString()
  startedAt!: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  endProgress?: number | null;

  // Only meaningful when the book has multiple file formats.
  @IsOptional()
  @IsString()
  @MaxLength(12)
  format?: string;
}
