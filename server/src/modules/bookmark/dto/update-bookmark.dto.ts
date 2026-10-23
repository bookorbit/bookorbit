import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export const BOOKMARK_TITLE_MAX_LENGTH = 500;
export const BOOKMARK_NOTE_MAX_LENGTH = 4000;

function trimText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** A blank note clears it, the same as sending null. */
function trimNote({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export class UpdateBookmarkDto {
  // Not nullable: a bookmark always has a title.
  @ValidateIf((o: UpdateBookmarkDto) => o.title !== undefined)
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BOOKMARK_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @Transform(trimNote)
  @ValidateIf((o: UpdateBookmarkDto) => o.note !== null)
  @IsString()
  @MaxLength(BOOKMARK_NOTE_MAX_LENGTH)
  note?: string | null;
}
