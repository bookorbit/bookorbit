export type Collection = {
  id: number;
  userId: number;
  name: string;
  icon: string | null;
  description: string | null;
  isPublic: boolean;
  isOwner: boolean;
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
  syncToKobo?: boolean;
};

export type CollectionSummary = {
  id: number;
  name: string;
  bookCount: number;
};
