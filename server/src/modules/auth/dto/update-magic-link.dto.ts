import { IsBoolean } from 'class-validator';

export class UpdateMagicLinkDto {
  @IsBoolean()
  isActive: boolean;
}
