import { IsBoolean } from 'class-validator';
import { BulkSelectionDto } from './bulk-selection.dto';

export class BulkSetMetadataLockDto extends BulkSelectionDto {
  @IsBoolean()
  locked!: boolean;
}
