export const SCROLLER_TYPE = {
  RECENTLY_ADDED: "recently-added",
  CONTINUE_READING: "continue-reading",
  RANDOM: "random",
  LENS: "lens",
} as const;

export type ScrollerType = (typeof SCROLLER_TYPE)[keyof typeof SCROLLER_TYPE];
export const SCROLLER_TYPES = Object.values(SCROLLER_TYPE) as ReadonlyArray<ScrollerType>;

export interface ScrollerConfig {
  id: string;
  type: ScrollerType;
  label: string;
  enabled: boolean;
  order: number;
  limit: number;
  lensId?: number;
}
