import type { GroupRule, SortSpec } from "./query";

export interface Lens {
  id: number;
  userId: number;
  name: string;
  icon: string | null;
  filter: GroupRule | null;
  defaultSort: SortSpec[];
  isPublic: boolean;
  displayOrder: number;
  bookCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLensPayload {
  name: string;
  icon: string;
  filter?: GroupRule;
  defaultSort: SortSpec[];
  isPublic?: boolean;
}
