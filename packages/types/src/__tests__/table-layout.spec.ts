import { describe, expect, it } from "vitest";

import { cloneTableLayout, validateTableLayout } from "../table-layout";

describe("validateTableLayout", () => {
  const knownIds = ["title", "authors", "rating"];

  it("returns null for null input", () => {
    expect(validateTableLayout(null, knownIds)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(validateTableLayout("nope", knownIds)).toBeNull();
  });

  it("returns null when columnOrder is missing", () => {
    expect(validateTableLayout({ hiddenColumns: [], columnWidths: {} }, knownIds)).toBeNull();
  });

  it("returns null when hiddenColumns is missing", () => {
    expect(validateTableLayout({ columnOrder: [], columnWidths: {} }, knownIds)).toBeNull();
  });

  it("filters unknown column ids from columnOrder", () => {
    expect(validateTableLayout({ columnOrder: ["unknown", "title"], hiddenColumns: [], columnWidths: {} }, knownIds)?.columnOrder).toEqual([
      "title",
      "authors",
      "rating",
    ]);
  });

  it("filters unknown column ids from hiddenColumns", () => {
    expect(
      validateTableLayout({ columnOrder: [...knownIds], hiddenColumns: ["unknown", "rating"], columnWidths: {} }, knownIds)?.hiddenColumns,
    ).toEqual(["rating"]);
  });

  it("appends missing known ids to columnOrder", () => {
    expect(validateTableLayout({ columnOrder: ["authors"], hiddenColumns: [], columnWidths: {} }, knownIds)?.columnOrder).toEqual([
      "authors",
      "title",
      "rating",
    ]);
  });

  it("validates and includes positive column widths", () => {
    expect(
      validateTableLayout({ columnOrder: [...knownIds], hiddenColumns: [], columnWidths: { title: 320, authors: 0, unknown: 100 } }, knownIds)
        ?.columnWidths,
    ).toEqual({ title: 320 });
  });

  it("rejects negative width values", () => {
    expect(validateTableLayout({ columnOrder: [...knownIds], hiddenColumns: [], columnWidths: { title: -1 } }, knownIds)?.columnWidths).toEqual({});
  });

  it("validates pinned columns to left/right/null only", () => {
    expect(
      validateTableLayout(
        {
          columnOrder: [...knownIds],
          hiddenColumns: [],
          columnWidths: {},
          pinnedColumns: { title: "left", authors: null, rating: "right", unknown: "left" },
        },
        knownIds,
      )?.pinnedColumns,
    ).toEqual({ title: "left", authors: null, rating: "right" });
  });

  it("returns a valid layout with all known ids in columnOrder", () => {
    expect(validateTableLayout({ columnOrder: ["title"], hiddenColumns: [], columnWidths: {} }, knownIds)).toEqual({
      columnOrder: ["title", "authors", "rating"],
      hiddenColumns: [],
      columnWidths: {},
      pinnedColumns: {},
    });
  });
});

describe("cloneTableLayout", () => {
  it("returns a deep clone", () => {
    const source = {
      columnOrder: ["title"],
      hiddenColumns: ["authors"],
      columnWidths: { title: 320 },
      pinnedColumns: { title: "left" as const },
    };

    const clone = cloneTableLayout(source);

    expect(clone).toEqual(source);
    expect(clone).not.toBe(source);
    expect(clone.columnOrder).not.toBe(source.columnOrder);
    expect(clone.hiddenColumns).not.toBe(source.hiddenColumns);
    expect(clone.columnWidths).not.toBe(source.columnWidths);
  });

  it("does not let clone mutations affect the original", () => {
    const source = {
      columnOrder: ["title"],
      hiddenColumns: ["authors"],
      columnWidths: { title: 320 },
      pinnedColumns: { title: "left" as const },
    };

    const clone = cloneTableLayout(source);
    clone.columnOrder.push("rating");
    clone.hiddenColumns.push("rating");
    clone.columnWidths.title = 640;
    clone.pinnedColumns!.title = "right";

    expect(source).toEqual({
      columnOrder: ["title"],
      hiddenColumns: ["authors"],
      columnWidths: { title: 320 },
      pinnedColumns: { title: "left" },
    });
  });

  it("clones pinnedColumns when present", () => {
    const source = {
      columnOrder: ["title"],
      hiddenColumns: [],
      columnWidths: {},
      pinnedColumns: { title: "left" as const },
    };

    const clone = cloneTableLayout(source);

    expect(clone.pinnedColumns).toEqual({ title: "left" });
    expect(clone.pinnedColumns).not.toBe(source.pinnedColumns);
  });

  it("omits pinnedColumns when source does not have them", () => {
    const source = {
      columnOrder: ["title"],
      hiddenColumns: [],
      columnWidths: {},
    };

    const clone = cloneTableLayout(source);

    expect("pinnedColumns" in clone).toBe(false);
  });
});
