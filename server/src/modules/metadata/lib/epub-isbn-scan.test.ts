import { Readable } from 'stream';

import { scanEpubSpineForIsbn } from './epub-isbn-scan';

const ISBN_13 = '9780306406157';
const ISBN_13_HUMAN = '978-0-306-40615-7';
const ISBN_13_OTHER = '9781635766264';

interface FakeFile {
  path: string;
  uncompressedSize: number;
  buffer: () => Promise<Buffer>;
  stream: () => Readable;
}

function file(path: string, content: string, sizeOverride?: number): FakeFile {
  const buf = Buffer.from(content);
  return {
    path,
    uncompressedSize: sizeOverride ?? buf.length,
    buffer: () => Promise.resolve(buf),
    stream: () => Readable.from([buf]),
  };
}

function zip(files: FakeFile[]) {
  return { files } as never;
}

function opf(manifestItems: string, spineRefs: string): string {
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf">
  <manifest>${manifestItems}</manifest>
  <spine>${spineRefs}</spine>
</package>`;
}

function htmlDoc(items: { id: string; href: string }[]): string {
  return items.map((i) => `<item id="${i.id}" href="${i.href}" media-type="application/xhtml+xml"/>`).join('');
}

function spine(ids: string[]): string {
  return ids.map((id) => `<itemref idref="${id}"/>`).join('');
}

function copyrightHtml(body: string): string {
  return `<html><body><p>${body}</p></body></html>`;
}

describe('scanEpubSpineForIsbn', () => {
  it('recovers a labeled ISBN from the copyright page', async () => {
    const manifest = htmlDoc([
      { id: 'cover', href: 'cover.xhtml' },
      { id: 'copy', href: 'copyright.xhtml' },
      { id: 'ch1', href: 'ch1.xhtml' },
    ]);
    const z = zip([
      file('cover.xhtml', copyrightHtml('A Novel')),
      file('copyright.xhtml', copyrightHtml(`ISBN: ${ISBN_13_HUMAN}`)),
      file('ch1.xhtml', copyrightHtml('Chapter One')),
    ]);

    const result = await scanEpubSpineForIsbn(z, opf(manifest, spine(['cover', 'copy', 'ch1'])), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: ISBN_13 });
  });

  it('prefers ISBN-13 when both forms appear on the page', async () => {
    const manifest = htmlDoc([{ id: 'copy', href: 'copyright.xhtml' }]);
    const z = zip([file('copyright.xhtml', copyrightHtml(`ISBN-13: ${ISBN_13_HUMAN} ISBN-10: 0-306-40615-2`))]);

    const result = await scanEpubSpineForIsbn(z, opf(manifest, spine(['copy'])), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: ISBN_13 });
  });

  it('returns the front-matter ISBN first (document-level early exit)', async () => {
    const manifest = htmlDoc([
      { id: 'copy', href: 'copyright.xhtml' },
      { id: 'back', href: 'back.xhtml' },
    ]);
    const z = zip([file('copyright.xhtml', copyrightHtml(`ISBN: ${ISBN_13_HUMAN}`)), file('back.xhtml', copyrightHtml(`ISBN: ${ISBN_13_OTHER}`))]);

    const result = await scanEpubSpineForIsbn(z, opf(manifest, spine(['copy', 'back'])), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: ISBN_13 });
  });

  it('finds an ISBN that lives only in back matter (last-5 window)', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `d${i}`);
    const manifest = htmlDoc(ids.map((id) => ({ id, href: `${id}.xhtml` })));
    const files = ids.map((id, i) => file(`${id}.xhtml`, copyrightHtml(i === 17 ? `ISBN: ${ISBN_13_HUMAN}` : 'text')));

    const result = await scanEpubSpineForIsbn(zip(files), opf(manifest, spine(ids)), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: ISBN_13 });
  });

  it('does not find an ISBN that lives outside the window', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `d${i}`);
    const manifest = htmlDoc(ids.map((id) => ({ id, href: `${id}.xhtml` })));
    const files = ids.map((id, i) => file(`${id}.xhtml`, copyrightHtml(i === 12 ? `ISBN: ${ISBN_13_HUMAN}` : 'text')));

    const result = await scanEpubSpineForIsbn(zip(files), opf(manifest, spine(ids)), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: null });
  });

  it('skips non-HTML spine items', async () => {
    const manifest = `<item id="img" href="page.svg" media-type="image/svg+xml"/>`;
    const z = zip([file('page.svg', `<svg>ISBN: ${ISBN_13_HUMAN}</svg>`)]);

    const result = await scanEpubSpineForIsbn(z, opf(manifest, spine(['img'])), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: null });
  });

  it('returns nulls for an empty spine', async () => {
    const result = await scanEpubSpineForIsbn(zip([]), opf('', ''), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: null });
  });

  it('returns nulls (and does not throw) when a document read fails', async () => {
    const manifest = htmlDoc([{ id: 'copy', href: 'copyright.xhtml' }]);
    const failing: FakeFile = {
      path: 'copyright.xhtml',
      uncompressedSize: 10,
      buffer: () => Promise.reject(new Error('boom')),
      stream: () => Readable.from([]),
    };

    const result = await scanEpubSpineForIsbn(zip([failing]), opf(manifest, spine(['copy'])), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: null });
  });

  it('continues past a failing document to a later one', async () => {
    const manifest = htmlDoc([
      { id: 'bad', href: 'bad.xhtml' },
      { id: 'copy', href: 'copyright.xhtml' },
    ]);
    const bad: FakeFile = {
      path: 'bad.xhtml',
      uncompressedSize: 10,
      buffer: () => Promise.reject(new Error('boom')),
      stream: () => Readable.from([]),
    };
    const z = zip([bad, file('copyright.xhtml', copyrightHtml(`ISBN: ${ISBN_13_HUMAN}`))]);

    const result = await scanEpubSpineForIsbn(z, opf(manifest, spine(['bad', 'copy'])), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: ISBN_13 });
  });

  it('streams oversized documents and still finds a front-matter ISBN', async () => {
    const manifest = htmlDoc([{ id: 'big', href: 'big.xhtml' }]);
    const content = copyrightHtml(`ISBN: ${ISBN_13_HUMAN}`) + ' '.repeat(2_200_000);
    const big = file('big.xhtml', content, content.length);

    const result = await scanEpubSpineForIsbn(zip([big]), opf(manifest, spine(['big'])), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: ISBN_13 });
  });

  it('resolves spine hrefs relative to a nested OPF directory', async () => {
    const manifest = htmlDoc([{ id: 'copy', href: 'text/copyright.xhtml' }]);
    const z = zip([file('OEBPS/text/copyright.xhtml', copyrightHtml(`ISBN: ${ISBN_13_HUMAN}`))]);

    const result = await scanEpubSpineForIsbn(z, opf(manifest, spine(['copy'])), 'OEBPS/content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: ISBN_13 });
  });

  it('returns nulls for malformed OPF XML', async () => {
    const result = await scanEpubSpineForIsbn(zip([file('a.xhtml', 'x')]), 'not really xml', 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: null });
  });

  it('never throws even when the zip itself misbehaves', async () => {
    const manifest = htmlDoc([{ id: 'copy', href: 'copyright.xhtml' }]);
    const throwingZip = {
      get files() {
        throw new Error('zip exploded');
      },
    } as never;

    const result = await scanEpubSpineForIsbn(throwingZip, opf(manifest, spine(['copy'])), 'content.opf');
    expect(result).toEqual({ isbn10: null, isbn13: null });
  });
});
