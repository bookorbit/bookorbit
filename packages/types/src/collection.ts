import type { CoverAspectRatio } from "./library";

export type Collection = {
  id: number;
  userId: number;
  name: string;
  icon: string | null;
  description: string | null;
  isPublic: boolean;
  isOwner: boolean;
  /** The grid's tile shape, set by the owner. Square also draws each book that has an audiobook as that audiobook. */
  coverAspectRatio: CoverAspectRatio;
  syncToKobo: boolean;
  displayOrder: number;
  bookCount: number;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateCollectionPayload = {
  name: string;
  icon: string;
  description?: string;
  isPublic?: boolean;
  coverAspectRatio?: CoverAspectRatio;
  syncToKobo?: boolean;
};

export type CollectionSummary = {
  id: number;
  name: string;
  bookCount: number;
};
