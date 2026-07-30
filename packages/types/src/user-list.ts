export const USER_LIST_STATES = ["admins", "active", "inactive"] as const;
export type UserListState = (typeof USER_LIST_STATES)[number];

export const USER_LIST_SORT_FIELDS = ["username", "name", "createdAt"] as const;
export type UserListSortField = (typeof USER_LIST_SORT_FIELDS)[number];
export type UserListSortDirection = "asc" | "desc";
