import { IsBoolean, IsOptional } from 'class-validator';
import { WriteBookChaptersDto } from './write-book-chapters.dto';

export class StartChapterJobDto extends WriteBookChaptersDto {
  @IsOptional()
  @IsBoolean()
  retry?: boolean;
}
