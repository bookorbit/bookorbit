export const OPDS_DEFAULT_PAGE_SIZE = 50;
export const OPDS_MIN_PAGE_SIZE = 1;
export const OPDS_MAX_PAGE_SIZE = 100;

export type OpdsSortOrder = "recent" | "title_asc" | "title_desc" | "author_asc" | "author_desc" | "series_asc" | "series_desc";

export interface OpdsUser {
  id: number;
  userId: number;
  username: string;
  sortOrder: OpdsSortOrder;
  pageSize: number;
  createdAt: string;
}

export interface CreateOpdsUserRequest {
  username: string;
  password: string;
  sortOrder?: OpdsSortOrder;
  pageSize?: number;
}

export interface UpdateOpdsUserRequest {
  sortOrder?: OpdsSortOrder;
  pageSize?: number;
}
