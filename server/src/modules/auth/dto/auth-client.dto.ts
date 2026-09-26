import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AuthClientKind } from '@bookorbit/types';

export class AuthClientDto {
  @IsOptional()
  @IsIn(['web', 'native'])
  clientKind?: AuthClientKind;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}
