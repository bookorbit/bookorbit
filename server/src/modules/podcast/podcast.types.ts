import type { PodcastChapter, PodcastTranscriptRef } from '@bookorbit/types';

export interface ParsedPodcastFeed {
  title: string;
  author: string | null;
  description: string | null;
  imageUrl: string | null;
  siteUrl: string | null;
  language: string | null;
  podcastType: string | null;
  explicit: boolean;
  categories: string[];
  episodes: ParsedPodcastEpisode[];
}

export interface ParsedPodcastEpisode {
  identity: string;
  guid: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  publishedAt: Date | null;
  season: string | null;
  episode: string | null;
  episodeType: string | null;
  durationSeconds: number | null;
  explicit: boolean;
  enclosureUrl: string;
  enclosureType: string | null;
  enclosureSizeBytes: number | null;
  chapters: PodcastChapter[];
  transcripts: PodcastTranscriptRef[];
}

export interface PodcastFeedFetchResult {
  feed: ParsedPodcastFeed | null;
  /** The decoded body the parser ran on, kept so a caller can store it. Null on a 304. */
  xml: string | null;
  finalUrl: string;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
  status: number;
}
