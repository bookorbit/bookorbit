import { Transform, Type } from 'class-transformer';

import { IsMetadataProviderKey } from '../../../common/decorators/is-metadata-provider-key.decorator';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Max,
  Min,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { CONCRETE_BOOK_MEDIA_KINDS, METADATA_CACHE_REQUEST_POLICIES, METADATA_SEARCH_MAX_RESULTS_PER_PROVIDER } from '@bookorbit/types';
import type { ConcreteBookMediaKind, MetadataCacheRequestPolicy, MetadataProviderKey } from '@bookorbit/types';

@ValidatorConstraint({ name: 'atLeastOneSearchTerm', async: false })
class AtLeastOneSearchTermConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as MetadataSearchDto;
    return !!(obj.bookId || obj.title?.trim() || obj.author?.trim() || obj.isbn?.trim());
  }

  defaultMessage(): string {
    return 'At least one of bookId, title, author, or isbn must be provided';
  }
}

function AtLeastOneSearchTerm(options?: ValidationOptions) {
  return function (constructor: new (...args: unknown[]) => unknown) {
    registerDecorator({
      name: 'atLeastOneSearchTerm',
      target: constructor,
      propertyName: '',
      options,
      constraints: [],
      validator: AtLeastOneSearchTermConstraint,
    });
  };
}

@AtLeastOneSearchTerm()
export class MetadataSearchDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  bookId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  isbn?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
    return value;
  })
  @IsBoolean()
  isAudiobook?: boolean;

  /**
   * The medium being searched for. Narrows the provider set to the ones that serve it, so an
   * e-book search is not answered with comic issues. `isAudiobook` follows from it when unset.
   */
  @IsOptional()
  @IsIn(CONCRETE_BOOK_MEDIA_KINDS)
  mediaKind?: ConcreteBookMediaKind;

  /**
   * Several media at once, for a search that asks for an ebook and an audiobook of the same work.
   * The providers are the union of the ones serving each medium; results are ranked as for the
   * first medium named, with audiobook-only providers still asked.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const items = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : undefined;
    return items?.map((item) => (typeof item === 'string' ? item.trim() : item)).filter((item) => item !== '');
  })
  @IsArray()
  @ArrayMaxSize(CONCRETE_BOOK_MEDIA_KINDS.length)
  @IsIn(CONCRETE_BOOK_MEDIA_KINDS, { each: true })
  mediaKinds?: ConcreteBookMediaKind[];

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
        .filter((item): item is MetadataProviderKey => typeof item === 'string' && item.length > 0);
    }

    return undefined;
  })
  @IsMetadataProviderKey({ each: true })
  providers?: MetadataProviderKey[];

  /**
   * `refresh` asks every provider live instead of answering from the metadata cache. Clients must
   * only send it to servers advertising the `metadata-search-cache` feature.
   */
  @IsOptional()
  @IsIn(METADATA_CACHE_REQUEST_POLICIES)
  cache?: MetadataCacheRequestPolicy;

  /**
   * How many ranked candidates each provider may contribute, for a search that browses rather than
   * matches one book. Absent keeps the matching default. Clients must only send it to servers
   * advertising the `metadata-search-results-per-provider` feature.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(METADATA_SEARCH_MAX_RESULTS_PER_PROVIDER)
  resultsPerProvider?: number;
}
