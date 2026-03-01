import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateEmailRecipientGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  defaultTemplateId?: number;
}
