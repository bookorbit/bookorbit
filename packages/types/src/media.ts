/**
 * Which medium a user-owned container holds. Books and podcasts never share rows: their
 * underlying tables are disjoint, so scopes and collections carry this discriminator and
 * each one belongs to exactly one medium.
 */
export const MEDIA_TYPES = ["books", "podcasts"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const DEFAULT_MEDIA_TYPE: MediaType = "books";

export function isMediaType(value: unknown): value is MediaType {
  return (MEDIA_TYPES as readonly unknown[]).includes(value);
}

export function normalizeMediaType(value: unknown): MediaType {
  return isMediaType(value) ? value : DEFAULT_MEDIA_TYPE;
}
