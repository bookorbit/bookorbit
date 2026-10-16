import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateTtsPreferencesDto {
  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  voiceId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(4)
  speed?: number;
}
