import { IsInt, Min } from 'class-validator';

export class LinkKoreaderUnmatchedBookDto {
  @IsInt()
  @Min(1)
  bookId!: number;
}

export class UpdateKoreaderManualHashLinkDto {
  @IsInt()
  @Min(1)
  bookId!: number;
}
