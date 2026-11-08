import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

import { BOOK_LINK_MAX_MEMBERS } from '@bookorbit/types';

export class BookLinkDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(BOOK_LINK_MAX_MEMBERS)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  bookIds!: number[];
}

export class BookLinkLeadDto {
  @IsInt()
  @Min(1)
  leadBookId!: number;
}
