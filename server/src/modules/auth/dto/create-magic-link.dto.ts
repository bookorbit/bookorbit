import { IsDateString, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMagicLinkDto {
  @IsInt()
  userId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
