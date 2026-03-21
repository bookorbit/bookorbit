export type ScrollerType = "recently-added" | "continue-reading" | "random" | "lens";

export interface ScrollerConfig {
  id: string;
  type: ScrollerType;
  label: string;
  enabled: boolean;
  order: number;
  limit: number;
  lensId?: number;
}
