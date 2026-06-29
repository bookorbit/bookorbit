import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

export class SmartScopeOrderItem {
  @IsInt()
  @Min(1)
  id: number;

  @IsInt()
  @Min(0)
  displayOrder: number;
}

export class ReorderSmartScopesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: SmartScopeOrderItem) => item.id)
  @ValidateNested({ each: true })
  @Type(() => SmartScopeOrderItem)
  order: SmartScopeOrderItem[];
}
