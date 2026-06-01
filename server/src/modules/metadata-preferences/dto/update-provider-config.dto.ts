import { IsBoolean, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ITUNES_COVER_RESOLUTIONS } from '@bookorbit/types';

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

export class ITunesProviderConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(ITUNES_COVER_RESOLUTIONS) coverResolution?: (typeof ITUNES_COVER_RESOLUTIONS)[number];
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
  @IsOptional() @ValidateNested() @Type(() => ITunesProviderConfigDto) itunes?: ITunesProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => AudibleProviderConfigDto) audible?: AudibleProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => SimpleProviderConfigDto) audnexus?: SimpleProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => ComicVineProviderConfigDto) comicvine?: ComicVineProviderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => SimpleProviderConfigDto) ranobedb?: SimpleProviderConfigDto;
}
