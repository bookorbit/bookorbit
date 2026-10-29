import { Injectable } from '@nestjs/common';
import { isExternalMetadataProviderKeySyntax, isKnownMetadataProviderKey, type MetadataProviderKey } from '@bookorbit/types';

import { ProviderIdRepository, type StoredExternalProviderId } from './provider-id.repository';

const MAX_ID_LENGTH = 512;
const MAX_URL_LENGTH = 2048;

export type ProviderIdMap = Partial<Record<MetadataProviderKey, string>>;

/** A provider id worth persisting outside `book_metadata`: any key without a column there, if well formed. */
export function isExternalProviderIdKey(key: string): boolean {
  return !isKnownMetadataProviderKey(key) && isExternalMetadataProviderKeySyntax(key);
}

/**
 * Ids from external providers. Keys with a column on `book_metadata` (the built-ins, and providers
 * that moved out but kept theirs) stay there, and every caller that writes those keeps doing so;
 * this store holds the rest, so a provider registered at runtime needs no column and no code. Keys
 * with a column passed in are ignored.
 */
@Injectable()
export class ProviderIdStore {
  constructor(private readonly repository: ProviderIdRepository) {}

  async read(bookId: number): Promise<ProviderIdMap> {
    return (await this.readMany([bookId])).get(bookId)?.ids ?? {};
  }

  async readMany(bookIds: readonly number[]): Promise<Map<number, { ids: ProviderIdMap; links: Partial<Record<string, string>> }>> {
    const result = new Map<number, { ids: ProviderIdMap; links: Partial<Record<string, string>> }>();
    for (const row of await this.repository.findByBookIds(bookIds)) {
      const entry = result.get(row.bookId) ?? { ids: {}, links: {} };
      entry.ids[row.provider] = row.externalId;
      if (row.sourceUrl) entry.links[row.provider] = row.sourceUrl;
      result.set(row.bookId, entry);
    }
    return result;
  }

  /**
   * Stores the external entries of `ids`. A string sets the id, null or an empty string deletes it,
   * and a key that is absent or undefined is left alone, the same meaning the built-in columns have.
   */
  async write(
    bookId: number,
    ids: Partial<Record<string, string | null | undefined>>,
    sources: Partial<Record<string, string | null | undefined>> = {},
  ): Promise<void> {
    const upserts: StoredExternalProviderId[] = [];
    const deletes: string[] = [];
    for (const [provider, raw] of Object.entries(ids)) {
      if (raw === undefined || !isExternalProviderIdKey(provider)) continue;
      const externalId = typeof raw === 'string' ? raw.trim() : '';
      if (!externalId) {
        deletes.push(provider);
        continue;
      }
      // An id too long for any provider is a different kind of value, not a long id; storing a
      // truncated one would point at the wrong record.
      if (externalId.length > MAX_ID_LENGTH) continue;
      upserts.push({ bookId, provider, externalId, sourceUrl: httpUrl(sources[provider]) });
    }
    await this.repository.upsert(upserts);
    await this.repository.delete(bookId, deletes);
  }
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
