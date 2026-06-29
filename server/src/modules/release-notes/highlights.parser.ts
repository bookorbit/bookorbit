import type { ReleaseHighlight, ReleaseMedia } from '@bookorbit/types';

import { MAX_HIGHLIGHTS_PER_RELEASE, MAX_MEDIA_PER_HIGHLIGHT } from './release-notes.constants';

const HEADING_RE = /^#{1,6}\s+/;
const HEADING_TEXT_RE = /^#{1,6}\s+(.+?)\s*$/;
const BULLET_RE = /^\s*[-*]\s+(.+)$/;
// Primary icon carrier: an HTML comment GitHub renders as nothing, e.g. `<!-- icon: BookHeart -->`.
const ICON_COMMENT_RE = /<!--\s*icon:\s*([A-Za-z][A-Za-z0-9]*)\s*-->/i;
// Anchored form: the whole comment IS an icon marker (not a larger comment that merely mentions one).
const ICON_COMMENT_ONLY_RE = /^<!--\s*icon:\s*[A-Za-z][A-Za-z0-9]*\s*-->$/i;
// Legacy carrier: a leading `[BookHeart]` token (renders as literal text on GitHub; kept for old releases).
const ICON_TOKEN_RE = /^\[([A-Za-z][A-Za-z0-9]*)\]\s*/;
const BOLD_TITLE_RE = /^\*\*(.+?)\*\*\s*/;
// Matches both `![alt](url)` and `[label](url)`.
const MEDIA_LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// Explicit image/video markup only (`![](url)`), used by the linter to flag dropped media.
const IMAGE_MD_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// GitHub's web editor inserts dropped images as `<img ... src="...">` (and video sources similarly).
const HTML_MEDIA_SRC_RE = /<(?:img|video|source)\b[^>]*?\bsrc=["']([^"']+)["']/gi;
const HTML_TAG_RE = /<[^>]+>/g;
const BARE_URL_RE = /https?:\/\/[^\s)"'<>\]]+/g;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$/i;
const LEADING_SEP_RE = /^\s*[-:–—]\s*/;

/** Strip HTML comments but preserve standalone `<!-- icon: X -->` markers so the parser can read the icon. */
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => (ICON_COMMENT_ONLY_RE.test(m.trim()) ? m : ''));
}

function isHighlightsHeading(line: string): boolean {
  const m = line.match(HEADING_TEXT_RE);
  if (!m) return false;
  return m[1].replace(/[^a-zA-Z]/g, '').toLowerCase() === 'highlights';
}

/** Only render media served from GitHub's own attachment hosts. */
export function isAllowedImageHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'github.com') return u.pathname.startsWith('/user-attachments/');
    return host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
}

/**
 * All allowlisted media in a block, in source order, de-duplicated, classified image/video by
 * extension. Ordering is by position in the text so interleaved `<img>`, `![](url)`, and bare URLs
 * keep the order the author wrote them. The three syntaxes can each match the same URL (e.g. a bare
 * URL inside a markdown image); the earliest-positioned occurrence wins via the `seen` set.
 */
function orderedAllowlistedMedia(text: string): ReleaseMedia[] {
  const found: { url: string; index: number }[] = [];
  for (const m of text.matchAll(HTML_MEDIA_SRC_RE)) found.push({ url: m[1], index: m.index ?? 0 });
  for (const m of text.matchAll(MEDIA_LINK_RE)) found.push({ url: m[1], index: m.index ?? 0 });
  for (const m of text.matchAll(BARE_URL_RE)) found.push({ url: m[0], index: m.index ?? 0 });
  found.sort((a, b) => a.index - b.index);

  const media: ReleaseMedia[] = [];
  const seen = new Set<string>();
  for (const { url } of found) {
    if (seen.has(url) || !isAllowedImageHost(url)) continue;
    seen.add(url);
    media.push({ url, type: VIDEO_EXT_RE.test(url) ? 'video' : 'image' });
  }
  return media;
}

/** URLs from explicit media markup (`<img>/<video>` tags and `![](url)`), for lint host-validation. */
export function findExplicitMediaUrls(text: string): string[] {
  const urls: string[] = [];
  for (const m of text.matchAll(HTML_MEDIA_SRC_RE)) urls.push(m[1]);
  for (const m of text.matchAll(IMAGE_MD_RE)) urls.push(m[1]);
  return urls;
}

export function extractHighlightsBlock(body: string): string[] | null {
  const lines = stripHtmlComments(body).split(/\r?\n/);
  const start = lines.findIndex(isHighlightsHeading);
  if (start === -1) return null;

  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (HEADING_RE.test(line)) break;
    block.push(line);
  }
  return block;
}

/** A parsed highlight plus its uncapped allowlisted media count, used by the linter for cap warnings. */
export interface ParsedHighlight {
  highlight: ReleaseHighlight;
  /** Total allowlisted media on the bullet before the `MAX_MEDIA_PER_HIGHLIGHT` cap is applied. */
  mediaCount: number;
}

/**
 * Parse the `## Highlights` section into highlights paired with their uncapped media count.
 * Tolerant: missing section -> []; missing/unknown icon -> null; malformed bullet -> skipped;
 * non-allowlisted image -> dropped (text kept); HTML-comment scaffold -> ignored.
 */
export function parseHighlightEntries(body: string | null | undefined): ParsedHighlight[] {
  if (!body) return [];
  const block = extractHighlightsBlock(body);
  if (!block) return [];

  const entries: { text: string; cont: string }[] = [];
  for (const line of block) {
    const bullet = line.match(BULLET_RE);
    if (bullet) {
      entries.push({ text: bullet[1].trim(), cont: '' });
    } else if (entries.length > 0) {
      entries[entries.length - 1].cont += `\n${line}`;
    }
  }

  const result: ParsedHighlight[] = [];
  for (const entry of entries) {
    const combined = `${entry.text}\n${entry.cont}`;
    const allMedia = orderedAllowlistedMedia(combined);
    const media = allMedia.slice(0, MAX_MEDIA_PER_HIGHLIGHT);

    // Prefer the `<!-- icon: X -->` comment (invisible on GitHub); fall back to a legacy `[X]` token.
    let icon: string | null = null;
    const iconComment = combined.match(ICON_COMMENT_RE);
    if (iconComment) icon = iconComment[1];

    let text = entry.text.replace(HTML_TAG_RE, '').replace(MEDIA_LINK_RE, '').replace(BARE_URL_RE, '').trim();

    const tokenMatch = text.match(ICON_TOKEN_RE);
    if (tokenMatch) {
      if (!icon) icon = tokenMatch[1];
      text = text.slice(tokenMatch[0].length);
    }

    let title: string;
    let highlightBody = '';
    const boldMatch = text.match(BOLD_TITLE_RE);
    if (boldMatch) {
      title = boldMatch[1].trim();
      highlightBody = text.slice(boldMatch[0].length).replace(LEADING_SEP_RE, '').trim();
    } else {
      title = text.replace(/\*\*/g, '').replace(LEADING_SEP_RE, '').trim();
    }

    if (!title) continue;

    result.push({ highlight: { icon, title, body: highlightBody, media }, mediaCount: allMedia.length });
    if (result.length >= MAX_HIGHLIGHTS_PER_RELEASE) break;
  }

  return result;
}

/** Structured highlights for the `## Highlights` section of a release body. */
export function parseHighlights(body: string | null | undefined): ReleaseHighlight[] {
  return parseHighlightEntries(body).map((e) => e.highlight);
}

/** Return the release body with the Highlights section removed, for the inline changelog. */
export function stripHighlightsSection(body: string | null | undefined): string | null {
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let removed = false;

  for (let i = 0; i < lines.length; i++) {
    if (!removed && isHighlightsHeading(lines[i])) {
      i++;
      while (i < lines.length && !HEADING_RE.test(lines[i])) i++;
      i--;
      removed = true;
      continue;
    }
    out.push(lines[i]);
  }

  const result = out.join('\n').trim();
  return result.length ? result : null;
}
