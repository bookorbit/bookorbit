import { IsInt } from 'class-validator';

export class PreviewTemplateDto {
  @IsInt()
  bookId: number;
}
