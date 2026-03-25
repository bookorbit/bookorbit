import { Validate } from 'class-validator';
import type { FieldPreferenceOverrides } from '@projectx/types';

import { IsFieldPreferencesMapConstraint } from './update-global-preferences.dto';

export class UpdateLibraryOverridesDto {
  @Validate(IsFieldPreferencesMapConstraint)
  overrides!: FieldPreferenceOverrides;
}
