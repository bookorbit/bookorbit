import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

export class CollectionOrderItem {
  @IsInt()
  @Min(1)
  id: number;

  @IsInt()
  @Min(0)
  displayOrder: number;
}

export class ReorderCollectionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CollectionOrderItem)
  order: CollectionOrderItem[];
}
