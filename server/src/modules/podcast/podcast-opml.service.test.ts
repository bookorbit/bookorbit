import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { PodcastOpmlService } from './podcast-opml.service';

describe('PodcastOpmlService', () => {
  const service = new PodcastOpmlService();

  it('extracts and deduplicates nested podcast feeds', () => {
    const result = service.parse(`
      <opml version="2.0"><body>
        <outline text="Group">
          <outline type="rss" xmlUrl="https://example.com/one.xml" />
          <outline type="rss" xmlUrl="https://example.com/one.xml" />
          <outline type="rss" xmlUrl="https://example.com/two.xml" />
        </outline>
      </body></opml>
    `);

    expect(result).toEqual(['https://example.com/one.xml', 'https://example.com/two.xml']);
  });

  it('rejects OPML without podcast feeds', () => {
    expect(() => service.parse('<opml version="2.0"><body><outline text="Empty" /></body></opml>')).toThrow(BadRequestException);
  });

  it('rejects credential-bearing feed URLs', () => {
    expect(() => service.parse('<opml><body><outline xmlUrl="https://user:secret@example.com/feed" /></body></opml>')).toThrow(BadRequestException);
  });

  it('escapes generated titles and URLs', () => {
    const value = service.generate('A & B', [{ title: 'One < Two', feedUrl: 'https://example.com/feed?a=1&b=2' }]);

    expect(value).toContain('<title>A &amp; B</title>');
    expect(value).toContain('text="One &lt; Two"');
    expect(value).toContain('xmlUrl="https://example.com/feed?a=1&amp;b=2"');
  });

  it('rejects imports with more than 5000 distinct feeds instead of truncating them', () => {
    const outlines = Array.from({ length: 5001 }, (_, index) => `<outline xmlUrl="https://example.com/${index}"/>`).join('');

    expect(() => service.parse(`<opml><body>${outlines}</body></opml>`)).toThrow('OPML contains more than 5000 podcast feeds');
  });
});
