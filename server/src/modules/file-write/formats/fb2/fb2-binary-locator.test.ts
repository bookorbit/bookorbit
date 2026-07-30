import { mkdtemp, open, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildBinaryElement, findBinarySpan, findRootCloseOffset } from './fb2-binary-locator';

const CHUNK_BYTES = 256 * 1024;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fb2-binary-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function withFile<T>(content: string, run: (handle: Awaited<ReturnType<typeof open>>, size: number) => Promise<T>): Promise<T> {
  const path = join(dir, 'book.fb2');
  const bytes = Buffer.from(content, 'latin1');
  await writeFile(path, bytes);
  const handle = await open(path, 'r');
  try {
    return await run(handle, bytes.length);
  } finally {
    await handle.close();
  }
}

async function spanOf(content: string, id: string, from = 0): Promise<string | null> {
  return withFile(content, async (handle, size) => {
    const span = await findBinarySpan(handle, id, from, size);
    return span ? content.slice(span.start, span.end) : null;
  });
}

describe('findBinarySpan', () => {
  it('finds a binary element by id', async () => {
    const content = '<body/><binary id="cover.jpg" content-type="image/jpeg">AAA</binary></FictionBook>';
    expect(await spanOf(content, 'cover.jpg')).toBe('<binary id="cover.jpg" content-type="image/jpeg">AAA</binary>');
  });

  it('finds a binary whose attributes are in the opposite order', async () => {
    const content = '<binary content-type="image/jpeg" id="cover.jpg">AAA</binary>';
    expect(await spanOf(content, 'cover.jpg')).toBe(content);
  });

  it('finds a binary with a single-quoted id', async () => {
    const content = "<binary id='cover.jpg' content-type='image/jpeg'>AAA</binary>";
    expect(await spanOf(content, 'cover.jpg')).toBe(content);
  });

  it('finds an id containing regex special characters', async () => {
    const content = '<binary id="cover(1).jpg" content-type="image/jpeg">AAA</binary>';
    expect(await spanOf(content, 'cover(1).jpg')).toBe(content);
  });

  it('picks the requested binary out of several', async () => {
    const content =
      '<binary id="img_1" content-type="image/jpeg">ONE</binary>\n' +
      '<binary id="cover.jpg" content-type="image/jpeg">TWO</binary>\n' +
      '<binary id="img_2" content-type="image/jpeg">THREE</binary>';
    expect(await spanOf(content, 'cover.jpg')).toContain('TWO');
    expect(await spanOf(content, 'img_2')).toContain('THREE');
  });

  it('returns null when no binary carries the id', async () => {
    const content = '<binary id="img_1" content-type="image/jpeg">AAA</binary>';
    expect(await spanOf(content, 'cover.jpg')).toBeNull();
  });

  it('returns null for a file with no binaries at all', async () => {
    expect(await spanOf('<FictionBook><body/></FictionBook>', 'cover.jpg')).toBeNull();
  });

  it('ignores binaries before the requested start offset', async () => {
    const first = '<binary id="cover.jpg">EARLY</binary>';
    const content = `${first}<binary id="cover.jpg">LATE</binary>`;
    expect(await spanOf(content, 'cover.jpg', first.length)).toContain('LATE');
  });

  it('finds a start tag that straddles a chunk boundary', async () => {
    const tag = '<binary id="cover.jpg" content-type="image/jpeg">';
    // Place the tag so its closing '>' falls into the next chunk read.
    const padding = 'x'.repeat(CHUNK_BYTES - 3);
    const content = `${padding}${tag}PAYLOAD</binary></FictionBook>`;
    expect(await spanOf(content, 'cover.jpg')).toBe(`${tag}PAYLOAD</binary>`);
  });

  it('finds a closing tag several chunks after the start tag', async () => {
    const payload = 'A'.repeat(CHUNK_BYTES * 3);
    const content = `<body/><binary id="cover.jpg">${payload}</binary></FictionBook>`;
    const span = await spanOf(content, 'cover.jpg');
    expect(span?.startsWith('<binary id="cover.jpg">')).toBe(true);
    expect(span?.endsWith('</binary>')).toBe(true);
    expect(span).toHaveLength('<binary id="cover.jpg">'.length + payload.length + '</binary>'.length);
  });

  it('finds a binary that sits past several megabytes of body text', async () => {
    const body = `<body><section><p>${'word '.repeat(400_000)}</p></section></body>`;
    const content = `${body}<binary id="cover.jpg">PAYLOAD</binary></FictionBook>`;
    expect(await spanOf(content, 'cover.jpg')).toBe('<binary id="cover.jpg">PAYLOAD</binary>');
  });

  it('does not match a different id that shares a prefix', async () => {
    const content = '<binary id="cover.jpg.bak">AAA</binary>';
    expect(await spanOf(content, 'cover.jpg')).toBeNull();
  });
});

describe('findRootCloseOffset', () => {
  it('finds the offset of the root closing tag', async () => {
    const content = '<FictionBook><body/></FictionBook>\n';
    const offset = await withFile(content, (handle, size) => findRootCloseOffset(handle, size));
    expect(offset).toBe(content.indexOf('</FictionBook>'));
  });

  it('finds the root close after a large trailing binary', async () => {
    const content = `<binary id="c">${'A'.repeat(CHUNK_BYTES * 2)}</binary>\n</FictionBook>\n`;
    const offset = await withFile(content, (handle, size) => findRootCloseOffset(handle, size));
    expect(offset).toBe(content.lastIndexOf('</FictionBook>'));
  });

  it('uses the last root close when the text mentions an earlier one', async () => {
    const content = '<FictionBook><body><p>ends with &lt;/FictionBook&gt;</p></body></FictionBook>';
    const offset = await withFile(content, (handle, size) => findRootCloseOffset(handle, size));
    expect(offset).toBe(content.lastIndexOf('</FictionBook>'));
  });

  it('returns null when there is no root closing tag', async () => {
    const offset = await withFile('<FictionBook><body/>', (handle, size) => findRootCloseOffset(handle, size));
    expect(offset).toBeNull();
  });
});

describe('buildBinaryElement', () => {
  it('emits base64 content with the given id and content type', () => {
    const element = buildBinaryElement('cover.jpg', 'image/png', Buffer.from('hello'));
    expect(element).toBe('<binary id="cover.jpg" content-type="image/png">aGVsbG8=</binary>');
  });

  it('wraps long base64 at 76 columns without a trailing newline', () => {
    const element = buildBinaryElement('c', 'image/jpeg', Buffer.alloc(600, 7));
    const body = element.slice(element.indexOf('>') + 1, element.lastIndexOf('</binary>'));
    const lines = body.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 76)).toBe(true);
    expect(body.endsWith('\n')).toBe(false);
  });

  it('round-trips the original bytes through base64', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const element = buildBinaryElement('c', 'image/jpeg', bytes);
    const body = element.slice(element.indexOf('>') + 1, element.lastIndexOf('</binary>'));
    expect(Buffer.from(body.replace(/\s+/g, ''), 'base64').equals(bytes)).toBe(true);
  });

  it('escapes an id that contains markup characters', () => {
    expect(buildBinaryElement('a"b&c<d', 'image/jpeg', Buffer.alloc(0))).toContain('id="a&quot;b&amp;c&lt;d"');
  });
});
