/**
 * Capabilities this server supports, advertised so a client can tell a newer server from an
 * older one before sending a field or calling a route the older one would reject. Append only:
 * a released client reads this list, so a value is never renamed or removed.
 *
 * Named apart from `APP_FEATURES` in app-features.ts, which holds the build-time feature flags.
 */
export const SERVER_FEATURES = ["annotation-stars", "annotation-color-names", "annotation-trash", "book-journal", "bookmark-edit", "notebook-hub"] as const;

export type ServerFeature = (typeof SERVER_FEATURES)[number];

export interface AppInfoResponse {
  version: string;
  updateAvailable: boolean | null;
  latestVersion: string | null;
  maxUploadSizeMb: number;
  /** Absent on servers older than the field itself, which a client treats as an empty list. */
  features?: ServerFeature[];
}
