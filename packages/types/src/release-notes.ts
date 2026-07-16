/** A single allowlisted (GitHub-hosted) media item attached to a highlight. */
export interface ReleaseMedia {
  url: string;
  type: "image" | "video";
}

export interface ReleaseHighlight {
  /** Lucide icon name parsed from an `<!-- icon: Name -->` comment (or legacy `[Name]` token), or null for the default icon. */
  icon: string | null;
  title: string;
  body: string;
  /** Allowlisted (GitHub-hosted) media in author order; images and videos interleaved. Empty if none. */
  media: ReleaseMedia[];
}

export interface ReleaseNote {
  /** Git tag, e.g. "v1.2.0". */
  version: string;
  /** Release title, or null. */
  name: string | null;
  /** ISO-8601 published date, or null. */
  date: string | null;
  highlights: ReleaseHighlight[];
  /** Link to the full GitHub release page. */
  changelogUrl: string;
  /** Raw markdown changelog with the Highlights section removed, for inline rendering. */
  changelogBody: string | null;
}

export interface ReleaseNotesResponse {
  releases: ReleaseNote[];
  /** Whether more releases exist beyond what was returned. */
  hasMore: boolean;
}

export interface WhatsNewPreferences {
  lastSeenVersion: string | null;
  popupEnabled: boolean;
}
