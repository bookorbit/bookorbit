import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

/** Shows are added by id: unlike books there is no rule-based selection to resolve. */
const MAX_SHOWS_PER_REQUEST = 500;

export class CollectionPodcastsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SHOWS_PER_REQUEST)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  podcastIds: number[];
}
