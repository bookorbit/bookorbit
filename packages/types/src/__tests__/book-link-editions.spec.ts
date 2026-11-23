import { describe, expect, it } from "vitest";

import { editionLabels, showsFirstPublished, sortEditions, type EditionLabelSource } from "../book-link";

const base: EditionLabelSource = { bookId: 1, libraryName: "Novels", formats: ["epub"] };

describe("editionLabels", () => {
  it("uses the edition name first", () => {
    const labels = editionLabels([{ ...base, editionName: "Full Cast", narrators: ["Scott Brick"], publisher: "Random House", publishedYear: 2024 }]);
    expect(labels.get(1)).toBe("Full Cast");
  });

  it("uses the edition name alone when nothing else is known", () => {
    expect(editionLabels([{ ...base, editionName: "  Read-along " }]).get(1)).toBe("Read-along");
  });

  it("uses the first narrator for an audio-only edition", () => {
    const labels = editionLabels([{ ...base, formats: ["m4b"], narrators: ["", "Rebecca Lowman"], publisher: "Knopf", publishedYear: 2026 }]);
    expect(labels.get(1)).toBe("Rebecca Lowman");
  });

  it("ignores narrators when the edition also holds an ebook", () => {
    const labels = editionLabels([
      { ...base, formats: ["epub", "m4b"], narrators: ["Scott Brick"], publisher: "Ballantine Books", publishedYear: 2012 },
    ]);
    expect(labels.get(1)).toBe("Ballantine Books · 2012");
  });

  it("uses either publisher or year alone when the other is missing", () => {
    const labels = editionLabels([
      { ...base, bookId: 1, publisher: "Tor" },
      { ...base, bookId: 2, publishedYear: 1999 },
    ]);
    expect(labels.get(1)).toBe("Tor");
    expect(labels.get(2)).toBe("1999");
  });

  it("falls back to the library", () => {
    expect(editionLabels([{ ...base, libraryName: "Audiobooks" }]).get(1)).toBe("Audiobooks");
  });

  it("adds the library to editions that would share a label", () => {
    const labels = editionLabels([
      { ...base, bookId: 1, publisher: "Tor", publishedYear: 2001, libraryName: "Novels" },
      { ...base, bookId: 2, publisher: "tor", publishedYear: 2001, libraryName: "Archive" },
      { ...base, bookId: 3, publisher: "Orbit", publishedYear: 2001, libraryName: "Novels" },
    ]);
    expect(labels.get(1)).toBe("Tor · 2001 · Novels");
    expect(labels.get(2)).toBe("tor · 2001 · Archive");
    expect(labels.get(3)).toBe("Orbit · 2001");
  });

  it("does not repeat the library when the label already is the library", () => {
    const labels = editionLabels([
      { ...base, bookId: 1, libraryName: "Novels" },
      { ...base, bookId: 2, libraryName: "Novels" },
    ]);
    expect(labels.get(1)).toBe("Novels");
    expect(labels.get(2)).toBe("Novels");
  });
});

describe("sortEditions", () => {
  const e = (
    bookId: number,
    extra: Partial<{
      isLead: boolean;
      formats: string[];
      publishedYear: number | null;
      lastReadAt: string | null;
      progress: { finished: boolean } | null;
    }> = {},
  ) => ({
    bookId,
    isLead: false,
    formats: ["epub"],
    publishedYear: null,
    lastReadAt: null,
    ...extra,
  });

  it("puts the main edition first, then read ones by recency, then ebooks before audio, newest first", () => {
    const sorted = sortEditions([
      e(1, { formats: ["m4b"], publishedYear: 2024 }),
      e(2, { publishedYear: 1992 }),
      e(3, { publishedYear: 2012 }),
      e(4, { lastReadAt: "2026-11-01T00:00:00Z" }),
      e(5, { lastReadAt: "2026-11-10T00:00:00Z", formats: ["m4b"] }),
      e(6, { isLead: true, publishedYear: 1990 }),
      e(7),
    ]);
    expect(sorted.map((x) => x.bookId)).toEqual([6, 5, 4, 3, 2, 7, 1]);
  });

  it("keeps the main edition first even when another was read", () => {
    const sorted = sortEditions([e(1, { lastReadAt: "2026-11-10T00:00:00Z" }), e(2, { isLead: true })]);
    expect(sorted.map((x) => x.bookId)).toEqual([2, 1]);
  });

  it("counts an edition marked finished as read, after the ones reading dates", () => {
    const sorted = sortEditions([
      e(1, { publishedYear: 2024 }),
      e(2, { formats: ["m4b"], progress: { finished: true } }),
      e(3, { lastReadAt: "2026-11-01T00:00:00Z" }),
      e(4, { progress: { finished: false } }),
    ]);
    expect(sorted.map((x) => x.bookId)).toEqual([3, 2, 1, 4]);
  });
});

describe("showsFirstPublished", () => {
  it("shows a year earlier than the published year", () => {
    expect(showsFirstPublished(1990, 2012)).toBe(true);
  });

  it("hides an unknown year, the same year and a later one", () => {
    expect(showsFirstPublished(null, 2012)).toBe(false);
    expect(showsFirstPublished(2012, 2012)).toBe(false);
    expect(showsFirstPublished(2015, 2012)).toBe(false);
  });

  it("shows the year when the published year is unknown", () => {
    expect(showsFirstPublished(1990, null)).toBe(true);
  });
});
