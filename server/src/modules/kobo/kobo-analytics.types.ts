export interface KoboAnalyticsEvent {
  Id: string;
  EventType: string;
  Timestamp: string;
  Metrics?: {
    SecondsRead?: number;
    IdleTime?: number;
    PagesTurned?: number;
    stars?: number;
    [key: string]: unknown;
  };
  Attributes?: {
    volumeid?: string;
    progress?: string;
    title?: string;
    [key: string]: unknown;
  };
}

export interface KoboAnalyticsBody {
  Events?: KoboAnalyticsEvent[];
  PlatformId?: string;
  SerialNumber?: string;
  AffiliateName?: string;
  ApplicationVersion?: string;
}
