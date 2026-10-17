import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsPositive, IsString, IsTimeZone, Max, MaxLength, Min } from 'class-validator';
import {
  AUDIT_CATEGORIES,
  AUDIT_LOG_KINDS,
  AUDIT_SECURITY_GROUP_KEYS,
  AuditAction,
  AuditResource,
  type AuditCategory,
  type AuditLogKind,
  type AuditSecurityGroup,
} from '@bookorbit/types';

const toInt = ({ value }: { value: string }) => parseInt(value, 10);

/** Filters shared by the list, the summary and the export. Every one is optional and narrows the result. */
export class AuditFilterQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  actorUsername?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @IsPositive()
  userId?: number;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditResource)
  resource?: AuditResource;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @IsPositive()
  resourceId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  ip?: string;

  @IsOptional()
  @IsIn(AUDIT_LOG_KINDS)
  kind?: AuditLogKind;

  @IsOptional()
  @IsIn(AUDIT_CATEGORIES)
  category?: AuditCategory;

  @IsOptional()
  @IsIn(AUDIT_SECURITY_GROUP_KEYS)
  securityGroup?: AuditSecurityGroup;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class AuditLogQueryDto extends AuditFilterQueryDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}

export class AuditExportQueryDto extends AuditFilterQueryDto {
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json' = 'csv';
}

export class AuditSignInQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  actorUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  ip?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** IANA zone the days are cut in; the viewer's own, so the groups match the dates they read. */
  @IsOptional()
  @IsTimeZone()
  tz?: string = 'UTC';

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}

export class AuditActorQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
