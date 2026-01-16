import { IsObject } from 'class-validator';

export class UpsertPreferenceDto {
  @IsObject()
  settings: Record<string, unknown>;
}
