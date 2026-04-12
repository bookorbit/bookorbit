import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEmailRecipientGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsInt()
  defaultTemplateId?: number | null;
}
