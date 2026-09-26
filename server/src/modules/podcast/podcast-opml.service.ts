import { BadRequestException, Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

type XmlObject = Record<string, unknown>;

@Injectable()
export class PodcastOpmlService {
  parse(value: string): string[] {
    let document: XmlObject;
    try {
      document = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false }).parse(value) as XmlObject;
    } catch {
      throw new BadRequestException('OPML is not valid XML');
    }
    const urls = new Set<string>();
    const pending = [...asArray(asObject(asObject(document.opml)?.body)?.outline)].reverse();
    let visited = 0;
    while (pending.length > 0) {
      const outline = asObject(pending.pop());
      if (!outline) continue;
      visited++;
      if (visited > 100_000) throw new BadRequestException('OPML contains too many outline entries');
      const url = normalizeHttpUrl(stringValue(outline['@_xmlUrl']) ?? stringValue(outline['@_url']));
      if (url && !urls.has(url)) {
        if (urls.size >= 5000) throw new BadRequestException('OPML contains more than 5000 podcast feeds');
        urls.add(url);
      }
      pending.push(...asArray(outline.outline).reverse());
    }
    if (urls.size === 0) throw new BadRequestException('OPML does not contain podcast feeds');
    return [...urls];
  }

  generate(title: string, feeds: Array<{ title: string; feedUrl: string }>): string {
    return `${this.generateStart(title)}${feeds.map((feed) => this.generateOutline(feed)).join('')}${this.generateEnd()}`;
  }

  generateStart(title: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${escapeXml(title)}</title></head>\n  <body>\n`;
  }

  generateOutline(feed: { title: string; feedUrl: string }): string {
    const title = escapeXml(feed.title);
    return `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${escapeXml(feed.feedUrl)}"/>\n`;
  }

  generateEnd(): string {
    return '  </body>\n</opml>\n';
  }
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function asObject(value: unknown): XmlObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as XmlObject) : null;
}

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeHttpUrl(value: string | null): string | null {
  if (!value || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
