import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListRequesterOptionsDto {
  /**
   * Matched against a requester's display name and username. Without it the filter offers only
   * the first page of requesters, which on a large instance is a list that silently omits people.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;
}
