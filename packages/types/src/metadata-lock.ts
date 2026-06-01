export const BOOK_METADATA_LOCK_FIELDS = [
  "title",
  "subtitle",
  "authors",
  "description",
  "publisher",
  "publishedYear",
  "language",
  "pageCount",
  "seriesName",
  "seriesIndex",
  "isbn13",
  "isbn10",
  "genres",
  "tags",
  "rating",
  "narrators",
  "durationSeconds",
  "abridged",
  "googleBooksId",
  "goodreadsId",
  "amazonId",
  "hardcoverId",
  "openLibraryId",
  "itunesId",
  "audibleId",
  "comicvineId",
  "ranobedbId",
  "comicIssueNumber",
  "comicVolumeName",
  "comicStoryArcs",
  "comicPencillers",
  "comicInkers",
  "comicColorists",
  "comicLetterers",
  "comicCoverArtists",
  "comicCharacters",
  "comicTeams",
  "comicLocations",
  "cover",
] as const;

export type BookMetadataLockField = (typeof BOOK_METADATA_LOCK_FIELDS)[number];

export type BookMetadataLockGroupKey = "core" | "series" | "classification" | "audio" | "providers" | "comic" | "assets";

export interface BookMetadataLockGroup {
  key: BookMetadataLockGroupKey;
  label: string;
  fields: BookMetadataLockField[];
}

export const BOOK_METADATA_LOCK_GROUPS: BookMetadataLockGroup[] = [
  {
    key: "core",
    label: "Core metadata",
    fields: ["title", "subtitle", "authors", "description", "publisher", "publishedYear", "language", "pageCount", "isbn13", "isbn10", "rating"],
  },
  {
    key: "series",
    label: "Series",
    fields: ["seriesName", "seriesIndex"],
  },
  {
    key: "classification",
    label: "Classification",
    fields: ["genres", "tags"],
  },
  {
    key: "audio",
    label: "Audio",
    fields: ["narrators", "durationSeconds", "abridged"],
  },
  {
    key: "providers",
    label: "Provider IDs",
    fields: ["googleBooksId", "goodreadsId", "amazonId", "hardcoverId", "openLibraryId", "itunesId", "audibleId", "comicvineId", "ranobedbId"],
  },
  {
    key: "comic",
    label: "Comic",
    fields: [
      "comicIssueNumber",
      "comicVolumeName",
      "comicStoryArcs",
      "comicPencillers",
      "comicInkers",
      "comicColorists",
      "comicLetterers",
      "comicCoverArtists",
      "comicCharacters",
      "comicTeams",
      "comicLocations",
    ],
  },
  {
    key: "assets",
    label: "Assets",
    fields: ["cover"],
  },
];
