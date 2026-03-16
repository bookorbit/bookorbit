import { Type } from 'class-transformer';
import { IsArray, IsInt, Min, ValidateNested } from 'class-validator';

class CollectionOrderItem {
  @IsInt()
  @Min(1)
  id: number;

  @IsInt()
  @Min(0)
  displayOrder: number;
}

export class ReorderCollectionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollectionOrderItem)
  order: CollectionOrderItem[];
}
