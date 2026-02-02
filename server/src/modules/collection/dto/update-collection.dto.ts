import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCollectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
