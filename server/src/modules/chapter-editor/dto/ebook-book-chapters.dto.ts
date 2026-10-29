import { EBOOK_CHAPTER_SOURCES, type EbookChapterSource } from '@bookorbit/types';
import { IsIn } from 'class-validator';

export class EbookBookChaptersDto {
  @IsIn(EBOOK_CHAPTER_SOURCES)
  source!: EbookChapterSource;
}
