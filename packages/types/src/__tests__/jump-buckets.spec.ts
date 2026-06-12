import { describe, expect, it } from "vitest";

import { jumpBucketKindForSort } from "../jump-buckets";
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

  it("returns year for publishedYear sorts", () => {
    expect(jumpBucketKindForSort([{ field: "publishedYear", dir: "asc" }])).toBe("year");
    expect(jumpBucketKindForSort([{ field: "publishedYear", dir: "desc" }])).toBe("year");
  });

  it("returns letter for an empty sort (defaults to title asc)", () => {
    expect(jumpBucketKindForSort([])).toBe("letter");
  });

  it("returns null for ineligible primary sort fields", () => {
    const ineligible: SortSpec[][] = [
      [{ field: "addedAt", dir: "desc" }],
      [{ field: "rating", dir: "desc" }],
      [{ field: "fileSize", dir: "asc" }],
      [{ field: "random", dir: "asc" }],
    ];
    for (const sort of ineligible) {
      expect(jumpBucketKindForSort(sort)).toBeNull();
    }
  });

  it("only considers the primary sort field", () => {
    expect(
      jumpBucketKindForSort([
        { field: "addedAt", dir: "desc" },
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
