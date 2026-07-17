import { lintHighlights } from './highlights.lint';
import { MAX_BODY_LENGTH, MAX_MEDIA_PER_HIGHLIGHT, MAX_TITLE_LENGTH } from './release-notes.constants';

describe('lintHighlights', () => {
  it('passes a well-formed section with no errors or warnings', () => {
    const body = [
      '## Highlights',
      '- **Kobo sync** - syncs both ways now. <!-- icon: BookHeart -->',
      '- **Faster scroll** - instant now. <!-- icon: Zap -->',
    ].join('\n');
    const r = lintHighlights(body);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.highlightCount).toBe(2);
  });

  it('warns when a highlight uses the legacy [Icon] prefix', () => {
    const body = '## Highlights\n- [BookHeart] **Kobo sync** - syncs both ways now.';
    const r = lintHighlights(body);
    expect(r.warnings.some((w) => w.includes('legacy') && w.includes('icon: BookHeart'))).toBe(true);
    expect(r.highlightCount).toBe(1);
  });

  it('errors when there is no Highlights section', () => {
    const r = lintHighlights('### Features\n- a fix');
    expect(r.errors[0]).toContain('No "## Highlights" section');
    expect(r.highlightCount).toBe(0);
  });

  it('errors when the section exists but no bullets parse', () => {
    const r = lintHighlights('## Highlights\n\nsome prose but no bullets');
    expect(r.errors.some((e) => e.includes('no valid bullets'))).toBe(true);
  });

  it('warns when an explicit image uses a non-allowlisted host', () => {
    const body = ['## Highlights', '- **Thing** - body.', '![](https://imgur.com/x.png)'].join('\n');
    const r = lintHighlights(body);
    expect(
      r.warnings.some(
        (w) =>
          w ===
          'Media will be dropped (host not allowed): https://imgur.com/x.png. Use a GitHub user-attachments or githubusercontent URL (drag-drop into the release).',
      ),
    ).toBe(true);
  });

  it('does not warn for an allowlisted image', () => {
    const body = ['## Highlights', '- **Thing** - body.', '![](https://github.com/user-attachments/assets/abc)'].join('\n');
    expect(lintHighlights(body).warnings).toEqual([]);
  });

  it('warns on a malformed icon token left in the title', () => {
    const body = '## Highlights\n- [book heart] **Sync** - body.';
    const r = lintHighlights(body);
    expect(r.warnings.some((w) => w.includes('PascalCase'))).toBe(true);
  });

  it('warns on a highlight with no body text', () => {
    const body = '## Highlights\n- **Title only** <!-- icon: Zap -->';
    const r = lintHighlights(body);
    expect(r.warnings.some((w) => w.includes('no description'))).toBe(true);
  });

  it('warns when an icon name is not a known lucide icon', () => {
    const body = '## Highlights\n- **Sync** - body. <!-- icon: BookHart -->';
    const r = lintHighlights(body);
    expect(r.warnings.some((w) => w.includes('BookHart') && w.includes('not a known lucide icon'))).toBe(true);
  });

  it('does not warn for a valid lucide icon name', () => {
    const body = '## Highlights\n- **Sync** - body. <!-- icon: BookHeart -->';
    expect(lintHighlights(body).warnings).toEqual([]);
  });

  it('warns when a title exceeds the length cap', () => {
    const body = `## Highlights\n- **${'a'.repeat(MAX_TITLE_LENGTH + 10)}** - body.`;
    const r = lintHighlights(body);
    expect(r.warnings.some((w) => w.includes('title is') && w.includes('clamped'))).toBe(true);
  });

  it('warns when a body exceeds the length cap', () => {
    const body = `## Highlights\n- **Title** - ${'b'.repeat(MAX_BODY_LENGTH + 10)}`;
    const r = lintHighlights(body);
    expect(r.warnings.some((w) => w.includes('body is') && w.includes('clamped'))).toBe(true);
  });

  it('warns when a highlight has more media than the cap', () => {
    const lines = ['## Highlights', '- **Many** - lots of shots.'];
    for (let i = 0; i < MAX_MEDIA_PER_HIGHLIGHT + 2; i++) lines.push(`![](https://github.com/user-attachments/assets/img-${i})`);
    const r = lintHighlights(lines.join('\n'));
    expect(r.warnings.some((w) => w.includes('media items') && w.includes(`first ${MAX_MEDIA_PER_HIGHLIGHT}`))).toBe(true);
  });
});
