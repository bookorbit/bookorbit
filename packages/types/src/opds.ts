export type OpdsSortOrder = "recent" | "title_asc" | "title_desc" | "author_asc" | "author_desc" | "series_asc" | "series_desc";

export interface OpdsUser {
  id: number;
  userId: number;
  username: string;
  sortOrder: OpdsSortOrder;
  createdAt: string;
}

export interface CreateOpdsUserRequest {
  username: string;
  password: string;
  sortOrder?: OpdsSortOrder;
}

export interface UpdateOpdsUserRequest {
  sortOrder: OpdsSortOrder;
}
