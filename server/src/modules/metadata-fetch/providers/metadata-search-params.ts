import { MetadataProviderKey } from '@projectx/types';

export interface MetadataSearchParams {
  title?: string;
  author?: string;
  isbn?: string;
  existingProviderIds?: Partial<Record<MetadataProviderKey, string>>;
  isAudiobook?: boolean;
}
