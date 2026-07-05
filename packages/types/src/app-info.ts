export interface AppInfoResponse {
  version: string;
  updateAvailable: boolean | null;
  latestVersion: string | null;
  bookDockPath: string;
  maxUploadSizeMb: number;
}
