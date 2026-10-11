import type { ReadAloudDeliveryPreference } from "./delivery";

export type OpdsSortOrder = "recent" | "title_asc" | "title_desc" | "author_asc" | "author_desc" | "series_asc" | "series_desc";

export interface OpdsUser {
  id: number;
  userId: number;
  username: string;
  readAloudDelivery?: ReadAloudDeliveryPreference;
  sortOrder: OpdsSortOrder;
  createdAt: string;
}

export interface CreateOpdsUserRequest {
  username: string;
  password: string;
  readAloudDelivery?: ReadAloudDeliveryPreference;
  sortOrder?: OpdsSortOrder;
}

export interface UpdateOpdsUserRequest {
  readAloudDelivery?: ReadAloudDeliveryPreference;
  sortOrder?: OpdsSortOrder;
}
