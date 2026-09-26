import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class PatchPreferenceDto {
  @IsObject()
  @IsOptional()
  set?: Record<string, unknown>;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  unset?: string[];
}
