import { isAllowedImageHost, parseHighlights, stripHighlightsSection } from './highlights.parser';
import { MAX_MEDIA_PER_HIGHLIGHT } from './release-notes.constants';

const ATTACH = 'https://github.com/user-attachments/assets';

describe('parseHighlights', () => {
  it('parses a well-formed bullet with a trailing icon comment, title and body', () => {
    const body = ['## Highlights', '- **Kobo sync** - syncs both ways now. <!-- icon: BookHeart -->', '', '### Features', '- something'].join('\n');
    expect(parseHighlights(body)).toEqual([{ icon: 'BookHeart', title: 'Kobo sync', body: 'syncs both ways now.', media: [] }]);
  });

  it('reads an icon comment on a continuation line', () => {
    const body = ['## Highlights', '- **Kobo sync** - syncs both ways now.', '  <!-- icon: BookHeart -->'].join('\n');
    expect(parseHighlights(body)[0]).toEqual({ icon: 'BookHeart', title: 'Kobo sync', body: 'syncs both ways now.', media: [] });
  });

  it('matches the icon comment case-insensitively and trims whitespace', () => {
    const body = '## Highlights\n- **Thing** - body. <!--   ICON:  Zap   -->';
    expect(parseHighlights(body)[0].icon).toBe('Zap');
  });

  it('never leaks the icon comment into the rendered title or body', () => {
    const body = '## Highlights\n- **Hardened** - safer now. <!-- icon: ShieldCheck -->';
    const result = parseHighlights(body)[0];
    expect(result.title).toBe('Hardened');
    expect(result.body).toBe('safer now.');
    expect(result.icon).toBe('ShieldCheck');
  });

  it('still parses the legacy leading [Icon] token (old published releases)', () => {
    const body = ['## Highlights', '- [BookHeart] **Kobo sync** - syncs both ways now.'].join('\n');
    expect(parseHighlights(body)).toEqual([{ icon: 'BookHeart', title: 'Kobo sync', body: 'syncs both ways now.', media: [] }]);
  });

  it('prefers the icon comment over a legacy token when both are present', () => {
    const body = '## Highlights\n- [Zap] **Thing** - body. <!-- icon: BookHeart -->';
    expect(parseHighlights(body)[0].icon).toBe('BookHeart');
  });

  it('returns [] when there is no Highlights section', () => {
    expect(parseHighlights('### Features\n- a fix')).toEqual([]);
    expect(parseHighlights('')).toEqual([]);
    expect(parseHighlights(null)).toEqual([]);
    expect(parseHighlights(undefined)).toEqual([]);
  });

  it('defaults a missing icon token to null', () => {
    const body = '## Highlights\n- **Minor polish** - small tweaks.';
    expect(parseHighlights(body)).toEqual([{ icon: null, title: 'Minor polish', body: 'small tweaks.', media: [] }]);
  });

  it('passes an unknown icon name through (the lint and client safelist it)', () => {
    const body = '## Highlights\n- [TotallyNotALucideIcon] **Thing** - body.';
    expect(parseHighlights(body)[0].icon).toBe('TotallyNotALucideIcon');
  });

  it('is tolerant of a bullet without a bold title', () => {
    const body = '## Highlights\n- just some plain text';
    expect(parseHighlights(body)).toEqual([{ icon: null, title: 'just some plain text', body: '', media: [] }]);
  });

  it('keeps an allowlisted image as a single media item', () => {
    const body = ['## Highlights', '- [Zap] **Fast** - speed.', `  ![](${ATTACH}/abc-123)`].join('\n');
    expect(parseHighlights(body)[0]).toEqual({
      icon: 'Zap',
      title: 'Fast',
      body: 'speed.',
      media: [{ url: `${ATTACH}/abc-123`, type: 'image' }],
    });
  });

  it('classifies an allowlisted media URL with a video extension as a video media item', () => {
    const body = ['## Highlights', '- [Film] **Demo** - watch it.', '  ![](https://raw.githubusercontent.com/o/r/main/demo.mp4)'].join('\n');
    const result = parseHighlights(body)[0];
    expect(result.media).toEqual([{ url: 'https://raw.githubusercontent.com/o/r/main/demo.mp4', type: 'video' }]);
    expect(result.title).toBe('Demo');
  });

  it('extracts the clean src from a GitHub <img> HTML tag (no trailing quote)', () => {
    const body = [
      '## Highlights',
      '- [Shield] **Hardened** - safer now.',
      '',
      `<img width="800" height="450" alt="x" src="${ATTACH}/b7a04eef" />`,
    ].join('\n');
    const result = parseHighlights(body)[0];
    expect(result.media).toEqual([{ url: `${ATTACH}/b7a04eef`, type: 'image' }]);
    expect(result.title).toBe('Hardened');
    expect(result.body).toBe('safer now.');
  });

  it('collects multiple media under one bullet in document order, classifying each', () => {
    const body = [
      '## Highlights',
      '- **Gallery** - three shots.',
      `  <img src="${ATTACH}/one" />`,
      `  ![](${ATTACH}/two)`,
      `  ${ATTACH}/three.mp4`,
    ].join('\n');
    expect(parseHighlights(body)[0].media).toEqual([
      { url: `${ATTACH}/one`, type: 'image' },
      { url: `${ATTACH}/two`, type: 'image' },
      { url: `${ATTACH}/three.mp4`, type: 'video' },
    ]);
  });

  it('de-duplicates a markdown image (markdown link + bare URL match the same URL)', () => {
    const body = ['## Highlights', '- **One** - x.', `  ![](${ATTACH}/abc)`].join('\n');
    expect(parseHighlights(body)[0].media).toEqual([{ url: `${ATTACH}/abc`, type: 'image' }]);
  });

  it('drops non-allowlisted media while keeping allowlisted media (and the text)', () => {
    const body = ['## Highlights', '- **Fast** - speed. ![](https://evil.example.com/tracker.png)', `  ![](${ATTACH}/good)`].join('\n');
    const result = parseHighlights(body)[0];
    expect(result.media).toEqual([{ url: `${ATTACH}/good`, type: 'image' }]);
    expect(result.title).toBe('Fast');
    expect(result.body).toBe('speed.');
  });

  it('strips media markup from the title/body when media shares the bullet line', () => {
    const body = `## Highlights\n- **Fast** - speed. ![](${ATTACH}/abc)`;
    const result = parseHighlights(body)[0];
    expect(result.title).toBe('Fast');
    expect(result.body).toBe('speed.');
    expect(result.media).toEqual([{ url: `${ATTACH}/abc`, type: 'image' }]);
  });

  it(`caps media per highlight at MAX_MEDIA_PER_HIGHLIGHT (${MAX_MEDIA_PER_HIGHLIGHT}), keeping the first in order`, () => {
    const lines = ['## Highlights', '- **Many** - lots of shots.'];
    for (let i = 0; i < MAX_MEDIA_PER_HIGHLIGHT + 3; i++) lines.push(`  ![](${ATTACH}/img-${i})`);
    const media = parseHighlights(lines.join('\n'))[0].media;
    expect(media).toHaveLength(MAX_MEDIA_PER_HIGHLIGHT);
    expect(media[0].url).toBe(`${ATTACH}/img-0`);
    expect(media[MAX_MEDIA_PER_HIGHLIGHT - 1].url).toBe(`${ATTACH}/img-${MAX_MEDIA_PER_HIGHLIGHT - 1}`);
  });

  it('ignores an unfilled HTML-comment scaffold', () => {
    const body = [
      '## Highlights',
      '<!-- Author: 1 line per highlight, then delete this comment.',
      '     - [LucideIcon] **Title** - short user benefit -->',
      '',
      '### Features',
      '- x',
    ].join('\n');
    expect(parseHighlights(body)).toEqual([]);
  });

  it('fully strips a multi-line author comment even when it mentions an icon marker', () => {
    const body = [
      '## Highlights',
      '<!-- Author: 1 line per highlight; end a line with an icon comment, e.g.',
      '       - Add an icon like icon: BookHeart',
      '       - Image/video: drag the file in -->',
      '',
      '### Features',
      '- x',
    ].join('\n');
    expect(parseHighlights(body)).toEqual([]);
  });

  it('stops at the next heading but NOT at a horizontal rule', () => {
    const body = ['## Highlights', '- **One** - first.', '', '---', '', '- **Two** - second.', '', '### Features', '- not a highlight'].join('\n');
    expect(parseHighlights(body).map((h) => h.title)).toEqual(['One', 'Two']);
  });

  it('parses multiple highlights separated by horizontal rules (v2.0.0 format)', () => {
    const body = [
      '## Highlights',
      '- **A** - first. <!-- icon: Zap -->',
      '',
      '---',
      '',
      '- **B** - second. <!-- icon: Star -->',
      '',
      '---',
      '',
      '### Features',
      '- a feature',
    ].join('\n');
    const result = parseHighlights(body);
    expect(result.map((h) => h.title)).toEqual(['A', 'B']);
    expect(result[0].icon).toBe('Zap');
    expect(result[1].icon).toBe('Star');
  });

  it('parses CRLF bodies (GitHub web-editor line endings)', () => {
    const body = ['## Highlights', '- [BookHeart] **Kobo sync** - both ways now.', '', `${ATTACH}/abc`, '', '### Features', '- f'].join('\r\n');
    const result = parseHighlights(body);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Kobo sync');
    expect(result[0].body).toBe('both ways now.');
    expect(result[0].media).toEqual([{ url: `${ATTACH}/abc`, type: 'image' }]);
  });

  it('parses multiple highlights in order', () => {
    const body = ['## Highlights', '- [BookHeart] **A** - one.', '- [Zap] **B** - two.', '- **C** - three.'].join('\n');
    expect(parseHighlights(body).map((h) => h.title)).toEqual(['A', 'B', 'C']);
  });
});

describe('stripHighlightsSection', () => {
  it('removes the Highlights block but keeps the changelog', () => {
    const body = ['## Highlights', '- **A** - one.', '', '### Features', '- a feature'].join('\n');
    expect(stripHighlightsSection(body)).toBe('### Features\n- a feature');
  });

  it('strips the full Highlights block when bullets are separated by horizontal rules', () => {
    const body = ['## Highlights', '- **A** - one.', '', '---', '', '- **B** - two.', '', '### Features', '- a feature'].join('\n');
    expect(stripHighlightsSection(body)).toBe('### Features\n- a feature');
  });

  it('returns null when nothing remains', () => {
    expect(stripHighlightsSection('## Highlights\n- **A** - one.')).toBeNull();
    expect(stripHighlightsSection(null)).toBeNull();
  });
});

describe('isAllowedImageHost', () => {
  it('allows GitHub attachment hosts', () => {
    expect(isAllowedImageHost('https://github.com/user-attachments/assets/x')).toBe(true);
    expect(isAllowedImageHost('https://user-images.githubusercontent.com/1/x.png')).toBe(true);
    expect(isAllowedImageHost('https://private-user-images.githubusercontent.com/1/x.png')).toBe(true);
  });

  it('rejects other hosts, non-https, and github non-attachment paths', () => {
    expect(isAllowedImageHost('https://evil.example.com/x.png')).toBe(false);
    expect(isAllowedImageHost('http://github.com/user-attachments/assets/x')).toBe(false);
    expect(isAllowedImageHost('https://github.com/bookorbit/bookorbit/raw/main/x.png')).toBe(false);
    expect(isAllowedImageHost('not a url')).toBe(false);
  });
});
