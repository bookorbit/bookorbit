import type { ReadingSessionSource } from "./reading-session";

export const READING_SESSION_SOURCE_BUCKETS = ["bookorbit", "ios", "watchos", "android", "koreader", "kobo"] as const;
export type ReadingSessionSourceBucket = (typeof READING_SESSION_SOURCE_BUCKETS)[number];

export const READING_SESSION_SOURCE_BUCKET_LABELS: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: "BookOrbit",
  ios: "iOS app",
  watchos: "Apple Watch",
  android: "Android app",
  koreader: "KOReader",
  kobo: "Kobo",
};

// Web/manual and null/unknown history collapse into the general BookOrbit bucket.
// Native clients remain distinct so device attribution survives aggregation.
export function toReadingSessionSourceBucket(source: ReadingSessionSource | null | undefined): ReadingSessionSourceBucket {
  if (source === "ios") return "ios";
  if (source === "watchos") return "watchos";
  if (source === "android") return "android";
  if (source === "koreader") return "koreader";
  if (source === "kobo") return "kobo";
  return "bookorbit";
}

export function emptySourceBucketRecord(): Record<ReadingSessionSourceBucket, number> {
  return { bookorbit: 0, ios: 0, watchos: 0, android: 0, koreader: 0, kobo: 0 };
}
