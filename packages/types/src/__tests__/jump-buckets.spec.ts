import { describe, expect, it } from "vitest";

import { jumpBucketKindForSort, jumpRailStrategyForSort, temporalJumpBucketPrecisionForSort } from "../jump-buckets";
import type { SortSpec } from "../query";

describe("jumpBucketKindForSort", () => {
  it("returns letter for title sorts in both directions", () => {
    expect(jumpBucketKindForSort([{ field: "title", dir: "asc" }])).toBe("letter");
    expect(jumpBucketKindForSort([{ field: "title", dir: "desc" }])).toBe("letter");
  });

  it("returns letter for author sorts in both directions", () => {
    expect(jumpBucketKindForSort([{ field: "author", dir: "asc" }])).toBe("letter");
    expect(jumpBucketKindForSort([{ field: "author", dir: "desc" }])).toBe("letter");
  });

  it("returns letter for series and publisher sorts", () => {
    for (const field of ["series", "publisher"] as const) {
      expect(jumpBucketKindForSort([{ field, dir: "asc" }])).toBe("letter");
      expect(jumpBucketKindForSort([{ field, dir: "desc" }])).toBe("letter");
    }
  });

  it("returns category for language, format, and read status sorts", () => {
    for (const field of ["language", "format", "readStatus"] as const) {
      expect(jumpBucketKindForSort([{ field, dir: "asc" }])).toBe("category");
      expect(jumpBucketKindForSort([{ field, dir: "desc" }])).toBe("category");
    }
  });

  it("returns temporal for publishedYear sorts", () => {
    expect(jumpBucketKindForSort([{ field: "publishedYear", dir: "asc" }])).toBe("temporal");
    expect(jumpBucketKindForSort([{ field: "publishedYear", dir: "desc" }])).toBe("temporal");
  });

  it("returns temporal for all supported date sorts", () => {
    for (const field of ["addedAt", "updatedAt", "publishedDate", "lastReadAt", "startedAt", "finishedAt"] as const) {
      expect(jumpBucketKindForSort([{ field, dir: "asc" }])).toBe("temporal");
      expect(jumpBucketKindForSort([{ field, dir: "desc" }])).toBe("temporal");
    }
  });

  it("returns letter for an empty sort (defaults to title asc)", () => {
    expect(jumpBucketKindForSort([])).toBe("letter");
  });

  it("returns null for ineligible primary sort fields", () => {
    const ineligible: SortSpec[][] = [[{ field: "rating", dir: "desc" }], [{ field: "fileSize", dir: "asc" }], [{ field: "random", dir: "asc" }]];
    for (const sort of ineligible) {
      expect(jumpBucketKindForSort(sort)).toBeNull();
    }
  });

  it("only considers the primary sort field", () => {
    expect(
      jumpBucketKindForSort([
        { field: "rating", dir: "desc" },
        { field: "title", dir: "asc" },
      ]),
    ).toBeNull();
    expect(
      jumpBucketKindForSort([
        { field: "title", dir: "asc" },
        { field: "addedAt", dir: "desc" },
      ]),
    ).toBe("letter");
  });
});

describe("jumpRailStrategyForSort", () => {
  it("returns the temporal precision as part of the strategy", () => {
    expect(jumpRailStrategyForSort([{ field: "publishedDate", dir: "asc" }])).toEqual({ kind: "temporal", precision: "year" });
    expect(jumpRailStrategyForSort([{ field: "addedAt", dir: "asc" }])).toEqual({ kind: "temporal", precision: "date" });
  });

  it("returns strategy-only descriptors for discrete rails", () => {
    expect(jumpRailStrategyForSort([{ field: "publisher", dir: "asc" }])).toEqual({ kind: "letter" });
    expect(jumpRailStrategyForSort([{ field: "format", dir: "asc" }])).toEqual({ kind: "category" });
  });
});

describe("temporalJumpBucketPrecisionForSort", () => {
  it("keeps publication sorts at year precision", () => {
    expect(temporalJumpBucketPrecisionForSort([{ field: "publishedDate", dir: "asc" }])).toBe("year");
    expect(temporalJumpBucketPrecisionForSort([{ field: "publishedYear", dir: "asc" }])).toBe("year");
  });

  it("uses full date precision for exact timestamps", () => {
    for (const field of ["addedAt", "updatedAt", "lastReadAt", "startedAt", "finishedAt"] as const) {
      expect(temporalJumpBucketPrecisionForSort([{ field, dir: "asc" }])).toBe("date");
    }
  });

  it("returns null for non-temporal sorts", () => {
    expect(temporalJumpBucketPrecisionForSort([{ field: "title", dir: "asc" }])).toBeNull();
  });
});
