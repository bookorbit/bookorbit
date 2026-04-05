import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class DuplicateResolutionItemDto {
  @IsInt()
  @Min(1)
  targetBookId!: number;

  @IsString()
  selectedSourceBookId!: string;
}

export class ResolveDuplicateMatchesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DuplicateResolutionItemDto)
  resolutions!: DuplicateResolutionItemDto[];
}
