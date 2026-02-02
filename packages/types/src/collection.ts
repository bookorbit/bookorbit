export type Collection = {
  id: number;
  name: string;
  description: string | null;
  bookCount: number;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CollectionSummary = {
  id: number;
  name: string;
  bookCount: number;
};
