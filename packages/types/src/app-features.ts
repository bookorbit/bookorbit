export interface AppFeatures {
  podcasts: boolean;
}

export const APP_FEATURES = Object.freeze({
  podcasts: false,
} as const satisfies AppFeatures);
