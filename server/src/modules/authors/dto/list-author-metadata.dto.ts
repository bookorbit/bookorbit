import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuthorMetadataProviderKey } from '@projectx/types';

export class ListAuthorMetadataDto {
  @IsString()
  @IsNotEmpty()
  q!: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (Array.isArray(value)) {
      return value
        .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
        .map((item) => (typeof item === 'string' ? item.trim() : item))
        .filter((item): item is AuthorMetadataProviderKey => typeof item === 'string' && item.length > 0);
    }

    return value as AuthorMetadataProviderKey[];
  })
  @IsEnum(AuthorMetadataProviderKey, { each: true })
  providers?: AuthorMetadataProviderKey[];
}
