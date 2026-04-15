import { ArrayNotEmpty, IsArray, IsBoolean, IsInt } from 'class-validator';

export class BulkSetMetadataLockDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  bookIds: number[];

  @IsBoolean()
  locked!: boolean;
}
