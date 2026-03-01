import { ArrayMinSize, IsArray, IsInt, IsOptional } from 'class-validator';

export class SendBookDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  bookIds: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  recipientIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  groupIds?: number[];

  @IsOptional()
  @IsInt()
  fileId?: number;

  @IsOptional()
  @IsInt()
  providerId?: number;

  @IsOptional()
  @IsInt()
  templateId?: number;
}
