import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class GoogleProviderConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() apiKey?: string;
}

export class AmazonProviderConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() domain?: string;
  @IsOptional() @IsString() cookie?: string;
}

export class SimpleProviderConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class HardcoverProviderConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() apiKey?: string;
}

export class AudibleProviderConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() domain?: string;
}

export class ComicVineProviderConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() apiKey?: string;
}

export class UpdateProviderConfigDto {
  @IsOptional() @ValidateNested() @Type(() => GoogleProviderConfigDto) google?: GoogleProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => AmazonProviderConfigDto) amazon?: AmazonProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => SimpleProviderConfigDto) goodreads?: SimpleProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => HardcoverProviderConfigDto) hardcover?: HardcoverProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => SimpleProviderConfigDto) openLibrary?: SimpleProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => SimpleProviderConfigDto) itunes?: SimpleProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => AudibleProviderConfigDto) audible?: AudibleProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => SimpleProviderConfigDto) audnexus?: SimpleProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => ComicVineProviderConfigDto) comicvine?: ComicVineProviderConfigDto;
}
