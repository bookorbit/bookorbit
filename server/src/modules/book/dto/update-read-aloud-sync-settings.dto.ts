import { IsIn } from 'class-validator';

import type { ReadAloudProgressSyncMode } from '@bookorbit/types';

export class UpdateReadAloudSyncSettingsDto {
  @IsIn(['auto', 'disabled'])
  mode!: ReadAloudProgressSyncMode;
}
