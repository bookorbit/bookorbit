import type { MediaType } from "./media";

export type Collection = {
  id: number;
  userId: number;
  mediaType: MediaType;
  name: string;
  icon: string | null;
  description: string | null;
  isPublic: boolean;
  isOwner: boolean;
  /** Books only; Kobo has no podcasts. */
  syncToKobo: boolean;
  displayOrder: number;
  /** Member books, on book collections. Always 0 on podcast collections. */
  bookCount: number;
  /** Member shows, on podcast collections. Always 0 on book collections. */
  podcastCount: number;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateCollectionPayload = {
  name: string;
  icon: string;
  description?: string;
  mediaType?: MediaType;
  isPublic?: boolean;
  syncToKobo?: boolean;
};

export type CollectionSummary = {
  id: number;
  mediaType: MediaType;
  name: string;
  bookCount: number;
  podcastCount: number;
};

/** The count that belongs to a collection's medium, so callers do not have to branch. */
export function collectionItemCount(collection: Pick<Collection, "mediaType" | "bookCount" | "podcastCount">): number {
  return collection.mediaType === "podcasts" ? collection.podcastCount : collection.bookCount;
}
