import { Type } from 'class-transformer';
import { IsArray, IsInt, Min, ValidateNested } from 'class-validator';

export class LibraryOrderItem {
  @IsInt()
  @Min(1)
  id: number;

  @IsInt()
  @Min(0)
  displayOrder: number;
}

export class ReorderLibrariesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LibraryOrderItem)
  order: LibraryOrderItem[];
}
