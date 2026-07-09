import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePersonalNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  note?: string | null;
}
