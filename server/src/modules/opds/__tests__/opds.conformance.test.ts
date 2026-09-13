import { XMLParser } from 'fast-xml-parser';

import { OpdsService } from '../opds.service';
import type { OpdsBookEntry } from '../opds-book.service';
import { OPDS_MIME_ACQ, OPDS_MIME_ATOM, OPDS_MIME_NAV, OPDS_MIME_SEARCH } from '../opds-xml.helpers';

const BASE = '/api/v1/opds';

const ATOM_NS = 'http://www.w3.org/2005/Atom';
const DC_NS = 'http://purl.org/dc/terms/';
const OPDS_NS = 'http://opds-spec.org/2010/catalog';
const OPENSEARCH_NS = 'http://a9.com/-/spec/opensearch/1.1/';

const ACQ_REL = 'http://opds-spec.org/acquisition';
const IMAGE_REL = 'http://opds-spec.org/image';
const THUMBNAIL_REL = 'http://opds-spec.org/image/thumbnail';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => name === 'entry' || name === 'link' || name === 'author',
});

function makeService() {
  return new OpdsService();
}

function parseFeed(xml: string): Record<string, any> {
  const root = parser.parse(xml);
  expect(root.feed).toBeDefined();
  return root.feed;
}

function links(node: Record<string, any>): Array<Record<string, string>> {
  return (node.link ?? []) as Array<Record<string, string>>;
}

function linkByRel(node: Record<string, any>, rel: string): Record<string, string> | undefined {
  return links(node).find((link) => link['@_rel'] === rel);
}

function entries(feed: Record<string, any>): Array<Record<string, any>> {
  return (feed.entry ?? []) as Array<Record<string, any>>;
}

function sampleBook(): OpdsBookEntry {
  return {
    id: 1,
    libraryId: 1,
    title: 'Mistborn: The Final Empire',
    folderPath: '/books/mistborn',
    addedAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02'),
    description: 'A fantasy novel by Brandon Sanderson',
    seriesId: 1,
    seriesName: 'Mistborn',
    seriesIndex: '1',
    language: 'en',
    publisher: 'Tor Books',
    isbn13: '9780765311788',
    hasCover: true,
    authors: ['Brandon Sanderson'],
    files: [{ id: 10, format: 'epub' }],
  };
}

function assertFeedEssentials(xml: string, feed: Record<string, any>) {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(feed['@_xmlns']).toBe(ATOM_NS);
  expect(feed['@_xmlns:dc']).toBe(DC_NS);
  expect(feed['@_xmlns:opds']).toBe(OPDS_NS);
  expect(feed['@_xmlns:opensearch']).toBe(OPENSEARCH_NS);
  expect(feed['@_xmlns:thr']).toBeUndefined();
  expect(xml).not.toContain('thr:');

  expect(feed.id).toEqual(expect.any(String));
  expect(feed.id).not.toHaveLength(0);
  expect(feed.title).toEqual(expect.any(String));
  expect(feed.title).not.toHaveLength(0);
  expect(() => new Date(feed.updated).toISOString()).not.toThrow();

  const feedAuthors = (feed.author ?? []) as Array<Record<string, string>>;
  expect(feedAuthors[0]).toMatchObject({
    name: 'bookorbit',
    uri: 'https://github.com/bookorbit/bookorbit',
  });
}

function assertEntryEssentials(entry: Record<string, any>) {
  expect(entry.id).toEqual(expect.any(String));
  expect(entry.id).not.toHaveLength(0);
  expect(entry.title).toEqual(expect.any(String));
  expect(entry.title).not.toHaveLength(0);
  expect(() => new Date(entry.updated).toISOString()).not.toThrow();
}

// Both search links are required. Compliant clients follow the OpenSearch descriptor;
// Moon+ Reader and CrossPoint only detect the inline templated link (issue #860).
function assertSearchLinks(feed: Record<string, any>) {
  const searchLinks = links(feed).filter((link) => link['@_rel'] === 'search');
  expect(searchLinks).toEqual([
    expect.objectContaining({ '@_href': `${BASE}/search.opds`, '@_type': OPDS_MIME_SEARCH }),
    expect.objectContaining({ '@_href': `${BASE}/catalog?q={searchTerms}`, '@_type': OPDS_MIME_ATOM }),
  ]);
}

function assertNavigationFeed(xml: string, expectedEntryTypes: Record<string, string>) {
  const feed = parseFeed(xml);
  assertFeedEssentials(xml, feed);
  expect(linkByRel(feed, 'self')?.['@_type']).toBe(OPDS_MIME_NAV);
  expect(linkByRel(feed, 'start')).toMatchObject({
    '@_href': BASE,
    '@_type': OPDS_MIME_NAV,
  });
  assertSearchLinks(feed);

  const navEntries = entries(feed);
  expect(navEntries).toHaveLength(Object.keys(expectedEntryTypes).length);
  for (const entry of navEntries) {
    assertEntryEssentials(entry);
    const expectedType = expectedEntryTypes[entry.title as string];
    expect(expectedType, `unexpected navigation entry: ${entry.title}`).toBeDefined();
    expect(linkByRel(entry, 'subsection')?.['@_type']).toBe(expectedType);
  }
}

describe('OPDS 1.2 conformance', () => {
  it('generates a conformant root navigation feed', () => {
    const xml = makeService().generateRootNavigation();
    assertNavigationFeed(xml, {
      'All Books': OPDS_MIME_ACQ,
      'Recent Books': OPDS_MIME_ACQ,
      'Random Books': OPDS_MIME_ACQ,
      Libraries: OPDS_MIME_NAV,
      Collections: OPDS_MIME_NAV,
      SmartScopes: OPDS_MIME_NAV,
      Authors: OPDS_MIME_NAV,
      Series: OPDS_MIME_NAV,
    });
  });

  it('generates a conformant libraries navigation feed', () => {
    const xml = makeService().generateLibrariesNavigation([
      { id: 1, name: 'Fiction', bookCount: 42 },
      { id: 2, name: 'Non-Fiction', bookCount: 13 },
    ]);
    assertNavigationFeed(xml, { Fiction: OPDS_MIME_ACQ, 'Non-Fiction': OPDS_MIME_ACQ });
  });

  it('generates a conformant collections navigation feed', () => {
    const xml = makeService().generateCollectionsNavigation([{ id: 5, name: 'Favorites', bookCount: 7 }]);
    assertNavigationFeed(xml, { Favorites: OPDS_MIME_ACQ });
  });

  it('generates a conformant smart-scopes navigation feed', () => {
    const xml = makeService().generateSmartScopesNavigation([{ id: 3, name: 'Unread', icon: null }]);
    assertNavigationFeed(xml, { Unread: OPDS_MIME_ACQ });
  });

  it('generates a conformant authors navigation feed', () => {
    const xml = makeService().generateAuthorsNavigation([{ name: 'Frank Herbert', bookCount: 3 }]);
    assertNavigationFeed(xml, { 'Frank Herbert': OPDS_MIME_ACQ });
  });

  it('generates a conformant series navigation feed', () => {
    const xml = makeService().generateSeriesNavigation([{ id: 42, name: 'The Lord of the Rings', bookCount: 3 }]);
    assertNavigationFeed(xml, { 'The Lord of the Rings': OPDS_MIME_ACQ });
  });

  it('generates a conformant acquisition feed and entry', () => {
    const xml = makeService().generateAcquisitionFeed(
      'Catalog',
      'urn:bookorbit:catalog',
      [sampleBook()],
      100,
      2,
      10,
      `${BASE}/catalog?page=2&size=10`,
      'test-token',
    );
    const feed = parseFeed(xml);

    assertFeedEssentials(xml, feed);
    expect(feed['opensearch:totalResults']).toBe('100');
    expect(linkByRel(feed, 'self')?.['@_type']).toBe(OPDS_MIME_ACQ);
    expect(linkByRel(feed, 'start')?.['@_type']).toBe(OPDS_MIME_NAV);
    assertSearchLinks(feed);

    for (const rel of ['first', 'previous', 'next', 'last']) {
      expect(linkByRel(feed, rel)?.['@_type']).toBe(OPDS_MIME_ACQ);
    }

    const entry = entries(feed)[0];
    assertEntryEssentials(entry);

    const acquisition = links(entry).find((link) => link['@_rel'] === ACQ_REL || link['@_rel'] === 'http://opds-spec.org/acquisition/open-access');
    expect(acquisition?.['@_type']).toBe('application/epub+zip');
    expect(linkByRel(entry, IMAGE_REL)?.['@_type']).toBe('image/jpeg');
    expect(linkByRel(entry, THUMBNAIL_REL)?.['@_type']).toBe('image/jpeg');

    const authorNames = ((entry.author ?? []) as Array<Record<string, string>>).map((author) => author.name);
    expect(authorNames).toContain('Brandon Sanderson');
  });

  it('generates a conformant OpenSearch descriptor', () => {
    const xml = makeService().generateOpenSearchDescription();
    const description = parser.parse(xml).OpenSearchDescription;

    expect(description).toBeDefined();
    expect(description['@_xmlns']).toBe(OPENSEARCH_NS);
    expect(description.ShortName).toBeTruthy();

    const urls = Array.isArray(description.Url) ? description.Url : [description.Url];
    const acquisitionUrl = urls.find((url: Record<string, string>) => url['@_type'] === OPDS_MIME_ACQ);
    expect(acquisitionUrl?.['@_template']).toContain('{searchTerms}');
  });
});
