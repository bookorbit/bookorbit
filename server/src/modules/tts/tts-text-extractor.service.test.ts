import { describe, it, expect } from 'vitest';
import { htmlToBlocks, normalizePath } from './tts-text-extractor.service';

describe('htmlToBlocks', () => {
  it('splits paragraphs into one block each', () => {
    expect(htmlToBlocks('<body><p>One.</p><p>Two.</p></body>')).toEqual(['One.', 'Two.']);
  });

  it('treats a heading and following paragraphs as separate ordered blocks', () => {
    expect(htmlToBlocks('<body><h1>Title</h1><p>Body para.</p></body>')).toEqual(['Title', 'Body para.']);
  });

  // Regression: leading content before the first block element used to become an
  // extra server-only block 0, shifting every audio block index by one (audio
  // played one paragraph behind the highlight). Foliate's getBlocks() drops it.
  it('drops bare text that appears before the first block-level element', () => {
    expect(htmlToBlocks('<body>Intro text<p>First para.</p><p>Second para.</p></body>')).toEqual(['First para.', 'Second para.']);
  });

  it('drops leading inline elements (e.g. drop-cap span) before the first block', () => {
    expect(htmlToBlocks('<body><span>Drop</span> lead<p>Real one.</p></body>')).toEqual(['Real one.']);
  });

  it('drops leading content even when the HTML is pretty-printed with newlines', () => {
    const html = '<body>\n  Intro\n  <p>First.</p>\n  <p>Second.</p>\n</body>';
    expect(htmlToBlocks(html)).toEqual(['First.', 'Second.']);
  });

  it('does not change well-formed chapters that already start with a block element', () => {
    const html = '<body>\n<p>Alpha.</p>\n<p>Bravo.</p>\n<p>Charlie.</p>\n</body>';
    expect(htmlToBlocks(html)).toEqual(['Alpha.', 'Bravo.', 'Charlie.']);
  });

  it('unwraps a single container div into its inner block elements', () => {
    expect(htmlToBlocks('<body><div class="chapter"><p>P1.</p><p>P2.</p></div></body>')).toEqual(['P1.', 'P2.']);
  });

  it('returns a single block when the body has no block-level elements', () => {
    expect(htmlToBlocks('<body>Just inline text with <em>emphasis</em>.</body>')).toEqual(['Just inline text with emphasis.']);
  });

  it('decodes entities and collapses whitespace within a block', () => {
    expect(htmlToBlocks('<body><p>Tom &amp; Jerry   say\n"hi".</p></body>')).toEqual(['Tom & Jerry say "hi".']);
  });

  // Regression: block text used to be unescaped from a six-entry table, so anything
  // outside it reached the TTS provider as raw markup. A Kokoro user heard
  // "dell hash thirty-nine Arbatskaja" for text the reader displayed as "dell'Arbatskaja".
  describe('character references', () => {
    it('decodes a decimal numeric reference', () => {
      expect(htmlToBlocks('<body><p>Lui aveva fatto l&#39;abitudine.</p></body>')).toEqual(["Lui aveva fatto l'abitudine."]);
    });

    it('decodes a hexadecimal numeric reference in either case', () => {
      expect(htmlToBlocks('<body><p>dell&#x27;Arbatskaja &#X2014; sì.</p></body>')).toEqual(["dell'Arbatskaja — sì."]);
    });

    it('decodes named references beyond the five XML ones', () => {
      expect(htmlToBlocks('<body><p>Caf&eacute; &agrave; Paris&hellip; &ldquo;c&rsquo;est bon&rdquo;</p></body>')).toEqual([
        'Café à Paris… “c’est bon”',
      ]);
    });

    it('still decodes the references the old table covered', () => {
      expect(htmlToBlocks('<body><p>Tom &amp; Jerry &quot;said&quot; it&apos;s fine.</p></body>')).toEqual(['Tom & Jerry "said" it\'s fine.']);
    });

    it('collapses a decoded non-breaking space like any other whitespace', () => {
      expect(htmlToBlocks('<body><p>Chapter&#160;One&nbsp;&nbsp;begins.</p></body>')).toEqual(['Chapter One begins.']);
    });

    // A second decoding pass would turn this into an apostrophe and silently rewrite a
    // book that is quoting the markup itself.
    it('decodes once, leaving an escaped reference escaped', () => {
      expect(htmlToBlocks('<body><p>Write &amp;#39; for an apostrophe.</p></body>')).toEqual(['Write &#39; for an apostrophe.']);
    });

    it('leaves a bare ampersand and an unknown reference alone', () => {
      expect(htmlToBlocks('<body><p>Fish & chips, AT&T, &zzz; too.</p></body>')).toEqual(['Fish & chips, AT&T, &zzz; too.']);
    });

    // Decoding before the split would let an escaped block tag open a new block and
    // shift every later index away from Foliate's highlight blocks.
    it('does not let a decoded reference create a block boundary', () => {
      expect(htmlToBlocks('<body><p>One &lt;p&gt; two.</p><p>Next.</p></body>')).toEqual(['One <p> two.', 'Next.']);
    });

    // Escaped markup is content the page displays, so it is content the narration reads.
    // Discarding it again after decoding would mute a programming book's code samples.
    it('keeps escaped markup that the page displays', () => {
      expect(htmlToBlocks('<body><pre>&lt;div class="x"&gt;hi&lt;/div&gt;</pre></body>')).toEqual(['<div class="x">hi</div>']);
    });

    it('keeps an escaped comparison operator', () => {
      expect(htmlToBlocks('<body><p>Se 5 &lt; 6, allora va bene.</p></body>')).toEqual(['Se 5 < 6, allora va bene.']);
    });

    // Block indices are positional, so a paragraph that is nothing but a reference has
    // to keep its slot rather than being dropped as empty.
    it('keeps a block whose only content is a reference', () => {
      expect(htmlToBlocks('<body><p>Before.</p><p>&#8212;</p><p>After.</p></body>')).toEqual(['Before.', '—', 'After.']);
    });

    it('decodes references inside inline markup', () => {
      expect(htmlToBlocks('<body><p>Il <em>tram&#8217;s</em> <b>l&#39;ultimo</b>.</p></body>')).toEqual(["Il tram’s l'ultimo."]);
    });

    it('decodes references in a table row block', () => {
      expect(htmlToBlocks('<body><table><tr><td>L&#39;autore</td></tr><tr><td>L&#39;anno</td></tr></table></body>')).toEqual(["L'autore", "L'anno"]);
    });
  });
});

describe('normalizePath', () => {
  it('returns a simple path unchanged', () => {
    expect(normalizePath('OEBPS/Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
  });

  it('collapses one .. segment', () => {
    expect(normalizePath('OEBPS/../Text/ch1.xhtml')).toBe('Text/ch1.xhtml');
  });

  it('collapses leading directory plus .. (epub relative href pattern)', () => {
    expect(normalizePath('OEBPS/../Text/chapter1.xhtml')).toBe('Text/chapter1.xhtml');
  });

  it('handles multiple .. segments', () => {
    expect(normalizePath('a/b/c/../../d.xhtml')).toBe('a/d.xhtml');
  });

  it('handles . segments', () => {
    expect(normalizePath('OEBPS/./Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
  });

  it('returns empty string for pure .. navigation', () => {
    expect(normalizePath('../ch1.xhtml')).toBe('ch1.xhtml');
  });

  it('handles no directory prefix', () => {
    expect(normalizePath('chapter1.xhtml')).toBe('chapter1.xhtml');
  });
});
