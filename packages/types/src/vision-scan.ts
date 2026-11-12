import type { VisualMatch } from "./visual-match";

/** What the photo shows: one book's front cover, or a shelf or pile of books. */
export const VISION_SCAN_KINDS = ["cover", "shelf"] as const;
export type VisionScanKind = (typeof VISION_SCAN_KINDS)[number];

/** Longest base64 photo `POST /mobile/vision-scan` takes: about 6 MiB of JPEG, PNG or WebP. */
export const VISION_SCAN_MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;
/** Most books one answer names. */
export const VISION_SCAN_MAX_BOOKS = 40;

export interface VisionScanRequest {
  kind: VisionScanKind;
  /** The photo as base64, without a `data:` prefix. */
  image: string;
}

/** Where a book is in the photo, in fractions of its width and height, from the top-left corner. */
export interface VisionScanBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionScanBook {
  /** The book's place in the answer, unique within it. */
  id: string;
  /** As the model read it on the spine or cover. */
  title: string;
  author: string | null;
  /** Null when the model could not place the book. */
  box: VisionScanBox | null;
  /** Books in the reader's libraries this one is, best first. Empty when it is not in them. */
  matches: VisualMatch[];
}

export interface VisionScanResponse {
  kind: VisionScanKind;
  /** In reading order; for a cover, the cover's own book first. Empty when nothing was readable. */
  books: VisionScanBook[];
}

/**
 * `errorCode` values of `POST /mobile/vision-scan`, so a client can say what went wrong in its own
 * words. A client treats any other code as `VISION_SCAN_PROVIDER`.
 */
export const VISION_SCAN_ERROR_CODES = [
  /** The admin turned photo scans off, or the Vision slot has no model. */
  "VISION_SCAN_OFF",
  /** This month's AI budget is used up. */
  "VISION_SCAN_BUDGET",
  /** The AI provider failed or sent an answer that could not be read. */
  "VISION_SCAN_PROVIDER",
  /** The provider took longer than the scan waits. */
  "VISION_SCAN_TIMEOUT",
  /** The model declined the photo. */
  "VISION_SCAN_REFUSED",
  /** The photo is not a JPEG, PNG or WebP image the server can read, or is too small. */
  "VISION_SCAN_IMAGE_INVALID",
] as const;
export type VisionScanErrorCode = (typeof VISION_SCAN_ERROR_CODES)[number];

/** In `app-info`: whether photo scans can run now. */
export interface VisionScanAppInfo {
  enabled: boolean;
}
