import { BadRequestException, Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'crypto';

import type { PodcastChapter, PodcastTranscriptRef } from '@bookorbit/types';
import { sanitizePodcastHtml } from './podcast-html-sanitizer';
import type { ParsedPodcastEpisode, ParsedPodcastFeed } from './podcast.types';

type XmlValue = Record<string, unknown>;

const MAX_FEED_EPISODES = 50_000;
const MAX_DESCRIPTION_LENGTH = 100_000;
const MAX_URL_LENGTH = 8192;
const MAX_TEXT_NESTING_DEPTH = 20;
const MAX_DURATION_SECONDS = 31_536_000;

@Injectable()
export class PodcastFeedParserService {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    processEntities: false,
    trimValues: true,
  });

  parse(xml: string): ParsedPodcastFeed {
    let document: XmlValue;
    try {
      document = this.parser.parse(xml) as XmlValue;
    } catch {
      throw new BadRequestException('Podcast feed is not valid XML');
    }
    const rss = asObject(document.rss);
    const channel = asObject(rss?.channel);
    if (channel) return this.parseRss(channel);
    const atom = asObject(document.feed);
    if (atom) return this.parseAtom(atom);
    throw new BadRequestException('Podcast feed must be RSS or Atom XML');
  }

  private parseRss(channel: XmlValue): ParsedPodcastFeed {
    const title = boundedText(channel.title, 1000);
    if (!title) throw new BadRequestException('Podcast feed is missing a title');
    const items = array(channel.item)
      .map(asObject)
      .filter((item): item is XmlValue => item !== null);
    assertEpisodeLimit(items.length);
    return {
      title,
      author: boundedText(channel.author, 1000) ?? boundedText(channel.creator, 1000),
      description: sanitizedHtml(channel.description ?? channel.summary),
      imageUrl: imageUrl(channel.image) ?? imageUrl(channel['itunes:image']),
      siteUrl: httpUrl(linkUrl(channel.link)),
      language: boundedText(channel.language, 100),
      podcastType: boundedText(channel.type, 50),
      explicit: booleanValue(channel.explicit),
      categories: uniqueStrings(array(channel.category).flatMap((value) => categoryText(value))),
      episodes: deduplicateEpisodes(
        items.map((item, index) => this.parseRssEpisode(item, index)).filter((item): item is ParsedPodcastEpisode => item !== null),
      ),
    };
  }

  private parseRssEpisode(item: XmlValue, index: number): ParsedPodcastEpisode | null {
    const enclosure = asObject(item.enclosure);
    const enclosureUrl = httpUrl(attribute(enclosure, 'url') ?? linkByRel(item.link, 'enclosure'));
    if (!enclosureUrl) return null;
    const guid = boundedText(item.guid, MAX_URL_LENGTH);
    const title = boundedText(item.title, 2000) ?? `Episode ${index + 1}`;
    const publishedAt = dateValue(item.pubDate) ?? dateValue(item.published) ?? dateValue(item.updated);
    return {
      identity: guid ?? enclosureUrl ?? `${title}|${publishedAt?.toISOString() ?? index}`,
      guid,
      title,
      subtitle: sanitizedHtml(item.subtitle, 10_000),
      description: sanitizedHtml(item.encoded ?? item.description ?? item.summary),
      publishedAt,
      season: boundedText(item.season, 100),
      episode: boundedText(item.episode, 100),
      episodeType: boundedText(item.episodeType, 50),
      durationSeconds: durationValue(item.duration),
      explicit: booleanValue(item.explicit),
      enclosureUrl,
      enclosureType: boundedString(attribute(enclosure, 'type'), 255),
      enclosureSizeBytes: nonnegativeSafeInteger(attribute(enclosure, 'length')),
      chapters: parseChapters(item.chapters),
      transcripts: parseTranscripts(item.transcript),
    };
  }

  private parseAtom(feed: XmlValue): ParsedPodcastFeed {
    const title = boundedText(feed.title, 1000);
    if (!title) throw new BadRequestException('Podcast feed is missing a title');
    const entries = array(feed.entry)
      .map(asObject)
      .filter((entry): entry is XmlValue => entry !== null);
    assertEpisodeLimit(entries.length);
    return {
      title,
      author: boundedText(asObject(feed.author)?.name, 1000),
      description: sanitizedHtml(feed.subtitle),
      imageUrl: httpUrl(text(feed.logo) ?? text(feed.icon)),
      siteUrl: httpUrl(linkByRel(feed.link, 'alternate')),
      language: boundedString(attribute(feed, 'lang'), 100),
      podcastType: null,
      explicit: false,
      categories: uniqueStrings(
        array(feed.category)
          .map((value) => attribute(value, 'term'))
          .filter(isString),
      ),
      episodes: deduplicateEpisodes(
        entries.map((entry, index) => this.parseAtomEpisode(entry, index)).filter((item): item is ParsedPodcastEpisode => item !== null),
      ),
    };
  }

  private parseAtomEpisode(entry: XmlValue, index: number): ParsedPodcastEpisode | null {
    const enclosureUrl = httpUrl(linkByRel(entry.link, 'enclosure'));
    if (!enclosureUrl) return null;
    const id = boundedText(entry.id, MAX_URL_LENGTH);
    const publishedAt = dateValue(entry.published) ?? dateValue(entry.updated);
    const title = boundedText(entry.title, 2000) ?? `Episode ${index + 1}`;
    const enclosureLink =
      array(entry.link)
        .map(asObject)
        .find((link) => attribute(link, 'rel') === 'enclosure') ?? null;
    return {
      identity: id ?? enclosureUrl,
      guid: id,
      title,
      subtitle: null,
      description: sanitizedHtml(entry.content ?? entry.summary),
      publishedAt,
      season: null,
      episode: null,
      episodeType: null,
      durationSeconds: null,
      explicit: false,
      enclosureUrl,
      enclosureType: boundedString(attribute(enclosureLink, 'type'), 255),
      enclosureSizeBytes: nonnegativeSafeInteger(attribute(enclosureLink, 'length')),
      chapters: [],
      transcripts: [],
    };
  }

  identityHash(identity: string): string {
    return createHash('sha256').update(identity, 'utf8').digest('hex');
  }
}

function asObject(value: unknown): XmlValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as XmlValue) : null;
}

function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown, depth = 0): string | null {
  if (depth >= MAX_TEXT_NESTING_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = text(item, depth + 1);
      if (resolved) return resolved;
    }
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null;
  const object = asObject(value);
  return object ? text(object['#text'], depth + 1) : null;
}

/** For values shown as text. HTML fields keep their escapes, because the sanitizer reads them as markup. */
function boundedText(value: unknown, maxLength: number): string | null {
  const raw = text(value);
  return boundedString(raw === null ? null : decodeXmlEntities(raw), maxLength);
}

function boundedString(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function sanitizedHtml(value: unknown, maxLength = MAX_DESCRIPTION_LENGTH): string | null {
  return sanitizePodcastHtml(boundedString(text(value), maxLength));
}

function attribute(value: unknown, name: string): string | null {
  return text(asObject(value)?.[`@_${name}`]);
}

function linkUrl(value: unknown): string | null {
  const links = array(value);
  for (const link of links) {
    const url = text(link);
    if (url) return url;
  }
  for (const link of links) {
    const object = asObject(link);
    const rel = attribute(object, 'rel');
    const url = attribute(object, 'href');
    if (url && (!rel || rel === 'alternate')) return url;
  }
  return links.map((link) => attribute(link, 'href')).find((url): url is string => url !== null) ?? null;
}

function linkByRel(value: unknown, rel: string): string | null {
  for (const candidate of array(value)) {
    const object = asObject(candidate);
    if (attribute(object, 'rel') === rel) return attribute(object, 'href');
  }
  return null;
}

function imageUrl(value: unknown): string | null {
  for (const candidate of array(value)) {
    const object = asObject(candidate);
    const url = text(object?.url) ?? attribute(object, 'href');
    const normalizedUrl = url?.replaceAll('&amp;', '&');
    const safeUrl = httpUrl(normalizedUrl ?? null);
    if (safeUrl) return safeUrl;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  const normalized = text(value)?.toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === '1' || normalized === 'explicit';
}

function dateValue(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ? null : date;
}

function durationValue(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return boundedDuration(raw);
  const parts = raw.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) return null;
  return boundedDuration(parts.reduce((total, part) => total * 60 + part, 0));
}

function boundedDuration(value: unknown): number | null {
  const parsed = nonnegativeNumber(value);
  return parsed !== null && parsed <= MAX_DURATION_SECONDS ? parsed : null;
}

function nonnegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nonnegativeSafeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function categoryText(value: unknown, depth = 0): string[] {
  if (depth >= 10) return [];
  const object = asObject(value);
  const own = boundedText(value, 200) ?? boundedString(attribute(object, 'text'), 200);
  return [
    ...(own ? [own] : []),
    ...array(object?.category)
      .slice(0, 100)
      .flatMap((child) => categoryText(child, depth + 1)),
  ];
}

function parseChapters(value: unknown): PodcastChapter[] {
  const object = asObject(value);
  const inline = array(object?.chapter)
    .map(asObject)
    .filter((chapter): chapter is XmlValue => chapter !== null);
  return inline
    .slice(0, 1000)
    .flatMap((chapter): PodcastChapter[] => {
      const title = boundedString(attribute(chapter, 'title'), 500) ?? boundedText(chapter.title, 500);
      const startSeconds = durationValue(attribute(chapter, 'start') ?? chapter.start);
      if (!title || startSeconds === null) return [];
      const url = httpUrl(attribute(chapter, 'href'));
      return [{ title, startSeconds, ...(url ? { url } : {}) }];
    })
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

function parseTranscripts(value: unknown): PodcastTranscriptRef[] {
  return array(value)
    .slice(0, 100)
    .flatMap((entry): PodcastTranscriptRef[] => {
      const url = httpUrl(attribute(entry, 'url') ?? text(entry));
      if (!url) return [];
      const type = boundedString(attribute(entry, 'type'), 255);
      const language = boundedString(attribute(entry, 'language'), 100);
      const rel = boundedString(attribute(entry, 'rel'), 100);
      return [
        {
          url,
          ...(type ? { type } : {}),
          ...(language ? { language } : {}),
          ...(rel ? { rel } : {}),
        },
      ];
    });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => decodeXmlEntities(value).trim()).filter(Boolean))].slice(0, 100);
}

/**
 * The five predefined XML entities and numeric character references, and nothing else.
 *
 * The parser runs with `processEntities: false` so a feed cannot declare its own entities and have
 * them expanded, which is what turns a DOCTYPE into a denial of service. That safety also leaves
 * `&amp;` sitting in the text, so a field printed as plain text showed the escape rather than the
 * ampersand its publisher wrote. These five cannot recurse, so decoding them costs nothing.
 *
 * One pass, not a chain of replacements: replacing `&amp;` first would turn `&amp;lt;` into `<`
 * rather than the `&lt;` the feed actually wrote.
 */
function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g, (match, decimal, hex, named) => {
    if (named) return XML_ENTITIES[named] ?? match;
    const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  });
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function httpUrl(value: string | null): string | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const normalized = value.trim();
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return normalized;
  } catch {
    return null;
  }
}

function assertEpisodeLimit(count: number): void {
  if (count > MAX_FEED_EPISODES) throw new BadRequestException(`Podcast feed contains more than ${MAX_FEED_EPISODES} episodes`);
}

function deduplicateEpisodes(episodes: ParsedPodcastEpisode[]): ParsedPodcastEpisode[] {
  const seen = new Set<string>();
  return episodes.filter((episode) => {
    if (seen.has(episode.identity)) return false;
    seen.add(episode.identity);
    return true;
  });
}
