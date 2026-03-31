import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

class LensOrderItem {
  @IsInt()
  @Min(1)
  id: number;

  @IsInt()
  @Min(0)
  displayOrder: number;
}

export class ReorderLensesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: LensOrderItem) => item.id)
  @ValidateNested({ each: true })
  @Type(() => LensOrderItem)
  order: LensOrderItem[];
}
