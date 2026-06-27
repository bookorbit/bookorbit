export interface KoboDevice {
  id: number;
  name: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface KoboDeviceWithToken extends KoboDevice {
  token: string;
}

export interface KoboSyncSettings {
  readingThreshold: number;
  finishedThreshold: number;
  convertToKepub: boolean;
  forceEnableHyphenation: boolean;
  kepubConversionLimitMb: number;
  twoWayProgressSync: boolean;
  syncBookOrbitAnnotationsToKobo: boolean;
}

export interface CreateKoboDeviceRequest {
  name: string;
}

export interface RenameKoboDeviceRequest {
  name: string;
}

export interface UpdateKoboSyncSettingsRequest {
  readingThreshold?: number;
  finishedThreshold?: number;
  convertToKepub?: boolean;
  forceEnableHyphenation?: boolean;
  kepubConversionLimitMb?: number;
  twoWayProgressSync?: boolean;
  syncBookOrbitAnnotationsToKobo?: boolean;
}
