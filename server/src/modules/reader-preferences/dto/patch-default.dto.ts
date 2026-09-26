import { IsObject, IsOptional } from 'class-validator';

export class PatchDefaultDto {
  @IsObject()
  @IsOptional()
  set?: Record<string, unknown>;
}
