export interface AppInfoResponse {
  version: string;
  updateAvailable: boolean | null;
  latestVersion: string | null;
  maxUploadSizeMb: number;
}
