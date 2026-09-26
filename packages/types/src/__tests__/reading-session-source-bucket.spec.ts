import { describe, expect, it } from "vitest";

import {
  READING_SESSION_SOURCE_BUCKETS,
  READING_SESSION_SOURCE_BUCKET_LABELS,
  emptySourceBucketRecord,
  toReadingSessionSourceBucket,
} from "../reading-session-source-bucket";

describe("toReadingSessionSourceBucket", () => {
  it("maps web to bookorbit", () => {
    expect(toReadingSessionSourceBucket("web")).toBe("bookorbit");
  });

  it("maps manual to bookorbit", () => {
    expect(toReadingSessionSourceBucket("manual")).toBe("bookorbit");
  });

  it("keeps iOS, Apple Watch and Android in distinct buckets", () => {
    expect(toReadingSessionSourceBucket("ios")).toBe("ios");
    expect(toReadingSessionSourceBucket("watchos")).toBe("watchos");
    expect(toReadingSessionSourceBucket("android")).toBe("android");
  });

  it("maps koreader to koreader", () => {
    expect(toReadingSessionSourceBucket("koreader")).toBe("koreader");
  });

  it("maps kobo to kobo", () => {
    expect(toReadingSessionSourceBucket("kobo")).toBe("kobo");
  });

  it("maps null/undefined to bookorbit", () => {
    expect(toReadingSessionSourceBucket(null)).toBe("bookorbit");
    expect(toReadingSessionSourceBucket(undefined)).toBe("bookorbit");
  });
});

describe("reading session source bucket constants", () => {
  it("exposes all six display buckets", () => {
    expect(READING_SESSION_SOURCE_BUCKETS).toEqual(["bookorbit", "ios", "watchos", "android", "koreader", "kobo"]);
  });

  it("labels every bucket", () => {
    expect(READING_SESSION_SOURCE_BUCKET_LABELS).toEqual({
      bookorbit: "BookOrbit",
      ios: "iOS app",
      watchos: "Apple Watch",
      android: "Android app",
      koreader: "KOReader",
      kobo: "Kobo",
    });
  });

  it("builds a zero-filled record", () => {
    expect(emptySourceBucketRecord()).toEqual({ bookorbit: 0, ios: 0, watchos: 0, android: 0, koreader: 0, kobo: 0 });
  });
});
