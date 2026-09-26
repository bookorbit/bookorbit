import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { PodcastFeedParserService } from './podcast-feed-parser.service';

describe('PodcastFeedParserService', () => {
  const parser = new PodcastFeedParserService();

  it('parses podcast metadata and sanitizes episode HTML', () => {
    const feed = parser.parse(`
      <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
        <channel>
          <title>Orbit Radio</title>
          <itunes:author>BookOrbit</itunes:author>
          <item>
            <guid>episode-1</guid>
            <title>First episode</title>
            <description><![CDATA[<p>Hello</p><script>alert(1)</script>]]></description>
            <enclosure url="https://cdn.example.com/episode.mp3" type="audio/mpeg" length="1234" />
            <itunes:duration>01:02:03</itunes:duration>
            <podcast:chapters><podcast:chapter start="00:10" title="News" /></podcast:chapters>
            <podcast:transcript url="https://cdn.example.com/episode.vtt" type="text/vtt" />
          </item>
        </channel>
      </rss>
    `);

    expect(feed.title).toBe('Orbit Radio');
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0]).toMatchObject({
      guid: 'episode-1',
      durationSeconds: 3723,
      enclosureSizeBytes: 1234,
      chapters: [{ title: 'News', startSeconds: 10 }],
      transcripts: [{ url: 'https://cdn.example.com/episode.vtt', type: 'text/vtt' }],
    });
    expect(feed.episodes[0]?.description).toBe('<p>Hello</p>');
  });

  it('extracts artwork when RSS and iTunes image tags share the same local name', () => {
    const feed = parser.parse(`
      <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Believed</title>
          <itunes:image href="https://media.npr.org/artwork.jpg?s=1400&amp;c=66&amp;f=jpg" />
          <image>
            <url>https://media.npr.org/artwork.jpg?s=1400&amp;c=66&amp;f=jpg</url>
          </image>
          <item>
            <title>Episode one</title>
            <enclosure url="https://media.npr.org/episode.mp3" type="audio/mpeg" />
          </item>
        </channel>
      </rss>
    `);

    expect(feed.imageUrl).toBe('https://media.npr.org/artwork.jpg?s=1400&c=66&f=jpg');
  });

  it('uses namespaced author metadata and a text website link when local names collide', () => {
    const feed = parser.parse(`
      <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
        <channel>
          <title>Audio Fiction</title>
          <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml" />
          <link>https://example.com</link>
          <author>The Cambridge Geek</author>
          <itunes:author>The Cambridge Geek</itunes:author>
          <itunes:category text="Society &amp; Culture" />
          <item>
            <title>Episode one</title>
            <enclosure url="https://cdn.example.com/episode.mp3" type="audio/mpeg" />
          </item>
        </channel>
      </rss>
    `);

    expect(feed).toMatchObject({
      author: 'The Cambridge Geek',
      siteUrl: 'https://example.com',
      categories: ['Society & Culture'],
    });
  });

  it('rejects XML that is not an RSS or Atom feed', () => {
    expect(() => parser.parse('<document><title>No feed</title></document>')).toThrow(BadRequestException);
  });

  it('deduplicates repeated episode identities before persistence', () => {
    const feed = parser.parse(`
      <rss><channel><title>Duplicates</title>
        <item><guid>same-guid</guid><title>First</title><enclosure url="https://example.com/one.mp3" /></item>
        <item><guid>same-guid</guid><title>Duplicate</title><enclosure url="https://example.com/two.mp3" /></item>
      </channel></rss>
    `);

    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0]?.title).toBe('First');
  });

  it('bounds database-backed text and rejects unsafe Atom artwork URLs', () => {
    const feed = parser.parse(`
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>${'T'.repeat(1200)}</title>
        <icon>file:///path/to/artwork.png</icon>
        <entry><id>one</id><title>${'E'.repeat(2200)}</title><link rel="enclosure" href="https://example.com/one.mp3" /></entry>
      </feed>
    `);

    expect(feed.title).toHaveLength(1000);
    expect(feed.imageUrl).toBeNull();
    expect(feed.episodes[0]?.title).toHaveLength(2000);
  });

  it('discards durations that exceed the supported storage range', () => {
    const feed = parser.parse(`
      <rss><channel><title>Duration limits</title>
        <item><title>Numeric</title><enclosure url="https://example.com/1.mp3"/><itunes:duration>999999999999999999999</itunes:duration></item>
        <item><title>Clock</title><enclosure url="https://example.com/2.mp3"/><itunes:duration>999999:00:00</itunes:duration></item>
      </channel></rss>
    `);

    expect(feed.episodes.map((episode) => episode.durationSeconds)).toEqual([null, null]);
  });
});
