import { IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateEmailRecipientGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  defaultTemplateId?: number | null;
}
