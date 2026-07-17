import { htmlToPlainText } from './html-to-text.utils';

describe('htmlToPlainText', () => {
  it('extracts text, decodes entities, and removes executable element contents', () => {
    expect(htmlToPlainText('<p>Hello &amp; <strong>world</strong></p><script>alert(1)</script>')).toBe('Hello & world');
  });

  it('removes entity-encoded tag-shaped markup without evaluating it', () => {
    expect(htmlToPlainText('&lt;script src="evil.js"&gt;alert(1)&lt;/script&gt; safe')).toBe('alert(1) safe');
  });

  it('preserves meaningful block and break boundaries when requested', () => {
    expect(htmlToPlainText('<p>First<br>line</p><p>Second</p>', { preserveLineBreaks: true })).toBe('First\nline\nSecond');
  });
});
