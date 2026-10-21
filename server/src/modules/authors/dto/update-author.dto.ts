import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from 'class-validator';

const MAX_AUTHOR_LIST_ITEMS = 50;
const MIN_LIFE_YEAR = -9999;
const MAX_LIFE_YEAR = 9999;

/**
 * Every field beyond `name`, `sortName` and `description` arrived with the `author-metadata-match`
 * server feature; clients must only send them to servers advertising it.
 */
export class UpdateAuthorDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sortName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  website?: string | null;

  /** A full date; its year replaces `birthYear`. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate?: string | null;

  /** Sent without `birthDate`, it clears the full date, which may name another year. */
  @IsOptional()
  @IsInt()
  @Min(MIN_LIFE_YEAR)
  @Max(MAX_LIFE_YEAR)
  birthYear?: number | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deathDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(MIN_LIFE_YEAR)
  @Max(MAX_LIFE_YEAR)
  deathYear?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_AUTHOR_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  genres?: string[] | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_AUTHOR_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  influences?: string[] | null;
}
