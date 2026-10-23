import { Injectable, Optional } from '@nestjs/common';

import { esc, fileMimeType, OPDS_MIME_ACQ, OPDS_MIME_ATOM, OPDS_MIME_NAV, OPDS_MIME_SEARCH, xmlEl, xmlLink } from './opds-xml.helpers';
import { htmlToPlainText } from '../../common/utils/html-to-text.utils';
import { DeliverySelectionService } from '../book/delivery-selection.service';
import type { OpdsRequestUser } from './opds-auth.guard';
import type { OpdsBookEntry } from './opds-book.service';

const BASE = '/api/v1/opds';
const SEARCH_TEMPLATE = `${BASE}/catalog?q={searchTerms}`;

@Injectable()
export class OpdsService {
  constructor(@Optional() private readonly selections?: DeliverySelectionService) {}
  generateRootNavigation(): string {
    const now = new Date().toISOString();
    return this.wrapFeed(
      'bookorbit OPDS Catalog',
      'urn:bookorbit:root',
      now,
      [xmlLink('self', BASE, OPDS_MIME_NAV), xmlLink('start', BASE, OPDS_MIME_NAV), ...this.searchLinks()],
      [
        this.navEntry('urn:bookorbit:all', 'All Books', 'Browse the full catalog', `${BASE}/catalog`, now),
        this.navEntry('urn:bookorbit:recent', 'Recent Books', 'Recently added books', `${BASE}/recent`, now),
        this.navEntry('urn:bookorbit:surprise', 'Random Books', '25 random picks', `${BASE}/surprise`, now),
        this.navEntry('urn:bookorbit:libraries', 'Libraries', 'Browse by library', `${BASE}/libraries`, now),
        this.navEntry('urn:bookorbit:collections', 'Collections', 'Browse your collections', `${BASE}/collections`, now),
        this.navEntry('urn:bookorbit:smartScopes', 'SmartScopes', 'Browse your smartScopes', `${BASE}/smart-scopes`, now),
        this.navEntry('urn:bookorbit:authors', 'Authors', 'Browse by author', `${BASE}/authors`, now),
        this.navEntry('urn:bookorbit:series', 'Series', 'Browse by series', `${BASE}/series`, now),
      ],
    );
  }

  generateLibrariesNavigation(libs: { id: number; name: string; bookCount: number }[]): string {
    const now = new Date().toISOString();
    const entries = libs.map((lib) =>
      this.navEntry(`urn:bookorbit:library:${lib.id}`, lib.name, `${lib.bookCount} books`, `${BASE}/catalog?libraryId=${lib.id}`, now),
    );
    return this.wrapFeed(
      'Libraries',
      'urn:bookorbit:libraries',
      now,
      [xmlLink('self', `${BASE}/libraries`, OPDS_MIME_NAV), ...this.searchLinks()],
      entries,
    );
  }

  generateCollectionsNavigation(cols: { id: number; name: string; bookCount: number }[]): string {
    const now = new Date().toISOString();
    const entries = cols.map((col) =>
      this.navEntry(`urn:bookorbit:collection:${col.id}`, col.name, `${col.bookCount} books`, `${BASE}/catalog?collectionId=${col.id}`, now),
    );
    return this.wrapFeed(
      'Collections',
      'urn:bookorbit:collections',
      now,
      [xmlLink('self', `${BASE}/collections`, OPDS_MIME_NAV), ...this.searchLinks()],
      entries,
    );
  }

  generateSmartScopesNavigation(items: { id: number; name: string; icon: string | null }[]): string {
    const now = new Date().toISOString();
    const entries = items.map((smartScope) =>
      this.navEntry(
        `urn:bookorbit:smartScope:${smartScope.id}`,
        smartScope.name,
        'Dynamic smartScope',
        `${BASE}/catalog?smartScopeId=${smartScope.id}`,
        now,
      ),
    );
    return this.wrapFeed(
      'SmartScopes',
      'urn:bookorbit:smartScopes',
      now,
      [xmlLink('self', `${BASE}/smart-scopes`, OPDS_MIME_NAV), ...this.searchLinks()],
      entries,
    );
  }

  generateAuthorsNavigation(items: { name: string; bookCount: number }[]): string {
    const now = new Date().toISOString();
    const entries = items.map((a) =>
      this.navEntry(
        `urn:bookorbit:author:${encodeURIComponent(a.name)}`,
        a.name,
        `${a.bookCount} books`,
        `${BASE}/catalog?author=${encodeURIComponent(a.name)}`,
        now,
      ),
    );
    return this.wrapFeed(
      'Authors',
      'urn:bookorbit:authors',
      now,
      [xmlLink('self', `${BASE}/authors`, OPDS_MIME_NAV), ...this.searchLinks()],
      entries,
    );
  }

  generateSeriesNavigation(items: { id?: number; name: string; bookCount: number }[]): string {
    const now = new Date().toISOString();
    const entries = items.map((s) =>
      this.navEntry(
        `urn:bookorbit:series:${s.id ?? encodeURIComponent(s.name)}`,
        s.name,
        `${s.bookCount} books`,
        s.id != null ? `${BASE}/catalog?seriesId=${s.id}` : `${BASE}/catalog?series=${encodeURIComponent(s.name)}`,
        now,
      ),
    );
    return this.wrapFeed('Series', 'urn:bookorbit:series', now, [xmlLink('self', `${BASE}/series`, OPDS_MIME_NAV), ...this.searchLinks()], entries);
  }

  generateAcquisitionFeed(
    title: string,
    feedId: string,
    books: OpdsBookEntry[],
    total: number,
    page: number,
    size: number,
    selfPath: string,
    coverToken: string,
    profile?: OpdsRequestUser,
  ): string {
    const now = new Date().toISOString();
    const totalPages = Math.max(1, Math.ceil(total / size));
    const links = [xmlLink('self', selfPath, OPDS_MIME_ACQ), xmlLink('start', BASE, OPDS_MIME_NAV), ...this.searchLinks()];

    const url = new URL(selfPath, 'http://localhost');
    const pageUrl = (p: number) => {
      url.searchParams.set('page', String(p));
      return `${url.pathname}?${url.searchParams.toString()}`;
    };

    if (page > 1) {
      links.push(xmlLink('first', pageUrl(1), OPDS_MIME_ACQ));
      links.push(xmlLink('previous', pageUrl(page - 1), OPDS_MIME_ACQ));
    }
    if (page < totalPages) {
      links.push(xmlLink('next', pageUrl(page + 1), OPDS_MIME_ACQ));
      links.push(xmlLink('last', pageUrl(totalPages), OPDS_MIME_ACQ));
    }

    const entries = books.map((book) => this.bookEntry(book, coverToken, profile));

    return this.wrapFeed(title, feedId, now, links, entries, total);
  }

  generateOpenSearchDescription(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
      `  ${xmlEl('ShortName', 'bookorbit OPDS')}`,
      `  ${xmlEl('Description', 'Search the bookorbit book catalog')}`,
      `  <Url type="${esc(OPDS_MIME_ACQ)}" template="${esc(SEARCH_TEMPLATE)}"/>`,
      '  <InputEncoding>UTF-8</InputEncoding>',
      '  <OutputEncoding>UTF-8</OutputEncoding>',
      '</OpenSearchDescription>',
    ].join('\n');
  }

  private bookEntry(book: OpdsBookEntry, coverToken: string, profile?: OpdsRequestUser): string {
    const lines: string[] = [];
    lines.push('<entry>');
    lines.push(`  ${xmlEl('title', book.title)}`);
    lines.push(`  ${xmlEl('id', `urn:bookorbit:book:${book.id}`)}`);
    lines.push(`  ${xmlEl('updated', book.updatedAt.toISOString())}`);

    for (const author of book.authors) {
      lines.push(`  <author>${xmlEl('name', author)}</author>`);
    }

    // Descriptions are stored as HTML. Clients that honour type="text" show markup literally,
    // and type="html" would hand unsanitized markup from book files and providers to clients
    // that render it, so the feed carries the text alone.
    const description = book.description ? htmlToPlainText(book.description, { preserveLineBreaks: true }) : '';
    if (description) {
      lines.push(`  <content type="text">${esc(description)}</content>`);
    } else {
      lines.push('  <content type="text"/>');
    }

    if (book.seriesName) {
      const seriesHref =
        book.seriesId != null ? `${BASE}/catalog?seriesId=${book.seriesId}` : `${BASE}/catalog?series=${encodeURIComponent(book.seriesName)}`;
      lines.push(
        `  <link rel="http://opds-spec.org/sort/series" href="${esc(seriesHref)}" title="${esc(book.seriesName)}${book.seriesIndex != null ? ` #${book.seriesIndex}` : ''}"/>`,
      );
    }

    if (book.language) {
      lines.push(`  ${xmlEl('dc:language', book.language)}`);
    }
    if (book.publisher) {
      lines.push(`  ${xmlEl('dc:publisher', book.publisher)}`);
    }
    if (book.isbn13) {
      lines.push(`  ${xmlEl('dc:identifier', `urn:isbn:${esc(book.isbn13)}`)}`);
    }

    if (book.hasCover) {
      lines.push(`  ${xmlLink('http://opds-spec.org/image', `${BASE}/${book.id}/cover?t=${encodeURIComponent(coverToken)}`, 'image/jpeg')}`);
      lines.push(
        `  ${xmlLink('http://opds-spec.org/image/thumbnail', `${BASE}/${book.id}/thumbnail?t=${encodeURIComponent(coverToken)}`, 'image/jpeg')}`,
      );
    }

    const variant = profile?.readAloudDelivery;
    const selectedFiles =
      variant === 'original'
        ? [...(book.allFiles ?? book.files)]
        : book.files.map((file) => book.allFiles?.find((candidate) => candidate.id === file.id) ?? file);
    if (variant === 'original') {
      const epubs = selectedFiles
        .filter((file) => file.format.toLowerCase() === 'epub')
        .sort(
          (a, b) => Number('mediaOverlayAvailable' in b && b.mediaOverlayAvailable) - Number('mediaOverlayAvailable' in a && a.mediaOverlayAvailable),
        );
      let index = 0;
      for (let i = 0; i < selectedFiles.length; i++) if (selectedFiles[i].format.toLowerCase() === 'epub') selectedFiles[i] = epubs[index++];
    }
    for (const file of selectedFiles) {
      const fileVariant = file.format.toLowerCase() === 'epub' ? variant : undefined;
      const narrated = 'mediaOverlayAvailable' in file && file.mediaOverlayAvailable;
      const selection =
        profile && this.selections && file.format.toLowerCase() === 'epub'
          ? this.selections.descriptor(
              profile.userId,
              `opds:${profile.opdsUserId}`,
              file.id,
              fileVariant ?? null,
              'contentVersion' in file ? String(file.contentVersion) : '',
            )
          : undefined;
      const href = `${BASE}/${book.id}/download?fileId=${file.id}${fileVariant ? `&variant=${fileVariant}` : ''}${selection ? `&selection=${encodeURIComponent(selection)}` : ''}`;
      const label =
        file.format.toUpperCase() +
        (fileVariant
          ? narrated && fileVariant === 'original'
            ? ' (with narration)'
            : fileVariant === 'audioless_epub'
              ? ' (text only)'
              : ' (original)'
          : '');
      const mime = fileMimeType(file.format);
      lines.push(`  ${xmlLink('http://opds-spec.org/acquisition', href, mime, label)}`);
    }

    lines.push('</entry>');
    return lines.join('\n');
  }

  // Both links are needed. Compliant clients follow the OpenSearch description; Moon+ Reader
  // and CrossPoint never fetch it and only detect search from a rel="search" href that already
  // contains {searchTerms}, so without the second link they hide search entirely (issue #860).
  private searchLinks(): string[] {
    return [xmlLink('search', `${BASE}/search.opds`, OPDS_MIME_SEARCH), xmlLink('search', SEARCH_TEMPLATE, OPDS_MIME_ATOM, 'Search')];
  }

  private navEntry(id: string, title: string, content: string, href: string, updated: string): string {
    return [
      '<entry>',
      `  ${xmlEl('title', title)}`,
      `  ${xmlEl('id', id)}`,
      `  ${xmlEl('updated', updated)}`,
      `  <content type="text">${esc(content)}</content>`,
      `  ${xmlLink('subsection', href, OPDS_MIME_NAV)}`,
      '</entry>',
    ].join('\n');
  }

  private wrapFeed(title: string, id: string, updated: string, links: string[], entries: string[], totalResults?: number): string {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom"',
      '      xmlns:dc="http://purl.org/dc/terms/"',
      '      xmlns:opds="http://opds-spec.org/2010/catalog"',
      '      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">',
      `  ${xmlEl('title', title)}`,
      `  ${xmlEl('id', id)}`,
      `  ${xmlEl('updated', updated)}`,
    ];

    if (totalResults !== undefined) {
      lines.push(`  ${xmlEl('opensearch:totalResults', String(totalResults))}`);
    }

    for (const link of links) {
      lines.push(`  ${link}`);
    }

    for (const entry of entries) {
      lines.push(entry);
    }

    lines.push('</feed>');
    return lines.join('\n');
  }
}
