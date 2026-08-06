import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough, Readable } from 'stream';
import * as unzipper from 'unzipper';

import { writeZipArchive, type ZipRewriteEntry } from './zip-rewrite';

const STORED_COMPRESSION_METHOD = 0;

let testRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-zip-rewrite-'));
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

function chunkedStream(value: string, chunks = 4): Readable {
  const size = Math.max(1, Math.ceil(value.length / chunks));
  const parts: Buffer[] = [];
  for (let offset = 0; offset < value.length; offset += size) parts.push(Buffer.from(value.slice(offset, offset + size)));
  return Readable.from(parts);
}

/** Tracks how many entry sources are open at once, which is what the eager-append regression cost. */
function trackedSources(count: number): { entries: ZipRewriteEntry[]; openOrder: string[]; maxConcurrentOpen: () => number } {
  const openOrder: string[] = [];
  let open = 0;
  let maxOpen = 0;

  const entries = Array.from({ length: count }, (_unused, index): ZipRewriteEntry => {
    const name = `pages/${String(index).padStart(4, '0')}.txt`;
    return {
      name,
      source: () => {
        openOrder.push(name);
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        const stream = chunkedStream(`contents of ${name}`);
        stream.once('end', () => {
          open -= 1;
        });
        return stream;
      },
    };
  });

  return { entries, openOrder, maxConcurrentOpen: () => maxOpen };
}

async function readArchive(filePath: string): Promise<Array<{ path: string; compressionMethod: number; content: string }>> {
  const zip = await unzipper.Open.file(filePath);
  return Promise.all(
    zip.files.map(async (entry) => ({
      path: entry.path,
      compressionMethod: entry.compressionMethod,
      content: (await entry.buffer()).toString('utf-8'),
    })),
  );
}

describe('writeZipArchive', () => {
  it('writes buffer and stream sources in the order they are yielded', async () => {
    const target = join(testRoot, 'out.zip');

    await writeZipArchive(target, [
      { name: 'mimetype', source: Buffer.from('application/epub+zip'), store: true },
      { name: 'META-INF/container.xml', source: () => chunkedStream('<container/>') },
      { name: 'OPS/content.opf', source: Buffer.from('<package/>') },
    ]);

    const written = await readArchive(target);
    expect(written.map((entry) => entry.path)).toEqual(['mimetype', 'META-INF/container.xml', 'OPS/content.opf']);
    expect(written.map((entry) => entry.content)).toEqual(['application/epub+zip', '<container/>', '<package/>']);
  });

  it('stores entries flagged with store and compresses the rest', async () => {
    const target = join(testRoot, 'out.zip');
    const compressible = 'a'.repeat(4096);

    await writeZipArchive(target, [
      { name: 'mimetype', source: Buffer.from('application/epub+zip'), store: true },
      { name: 'OPS/ch1.xhtml', source: Buffer.from(compressible) },
    ]);

    const written = await readArchive(target);
    expect(written[0]!.compressionMethod).toBe(STORED_COMPRESSION_METHOD);
    expect(written[1]!.compressionMethod).not.toBe(STORED_COMPRESSION_METHOD);
    expect(written[1]!.content).toBe(compressible);
  });

  it('opens at most one entry source at a time', async () => {
    const target = join(testRoot, 'out.zip');
    const { entries, openOrder, maxConcurrentOpen } = trackedSources(150);

    await writeZipArchive(target, entries);

    expect(maxConcurrentOpen()).toBe(1);
    expect(openOrder).toEqual(entries.map((entry) => entry.name));
    const written = await readArchive(target);
    expect(written).toHaveLength(150);
    expect(written[149]!.content).toBe('contents of pages/0149.txt');
  });

  it('does not open a source until the preceding sources have been consumed', async () => {
    const target = join(testRoot, 'out.zip');
    const drained: string[] = [];
    const seenWhenOpened = new Map<string, string[]>();
    const lazySource = (name: string) => () => {
      seenWhenOpened.set(name, [...drained]);
      const stream = chunkedStream(`contents of ${name}`);
      stream.once('end', () => {
        drained.push(name);
      });
      return stream;
    };

    await writeZipArchive(target, [
      { name: 'first', source: lazySource('first') },
      { name: 'second', source: lazySource('second') },
      { name: 'third', source: lazySource('third') },
    ]);

    expect(seenWhenOpened.get('first')).toEqual([]);
    expect(seenWhenOpened.get('second')).toEqual(['first']);
    expect(seenWhenOpened.get('third')).toEqual(['first', 'second']);
  });

  it('accepts an iterable that is consumed lazily', async () => {
    const target = join(testRoot, 'out.zip');
    let yielded = 0;
    function* entries(): Generator<ZipRewriteEntry> {
      for (const name of ['a.txt', 'b.txt', 'c.txt']) {
        yielded += 1;
        yield { name, source: Buffer.from(name) };
      }
    }

    await writeZipArchive(target, entries());

    expect(yielded).toBe(3);
    expect((await readArchive(target)).map((entry) => entry.path)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('writes zero-length entries without stalling the append loop', async () => {
    const target = join(testRoot, 'out.zip');

    await writeZipArchive(target, [
      { name: 'empty.txt', source: Buffer.alloc(0) },
      { name: 'after-empty.txt', source: Buffer.from('still written') },
    ]);

    const written = await readArchive(target);
    expect(written.map((entry) => entry.path)).toEqual(['empty.txt', 'after-empty.txt']);
    expect(written.map((entry) => entry.content)).toEqual(['', 'still written']);
  });

  it('writes an empty archive when there are no entries', async () => {
    const target = join(testRoot, 'empty.zip');

    await writeZipArchive(target, []);

    await expect(readArchive(target)).resolves.toEqual([]);
  });

  it('rejects with the source error and stops opening further sources', async () => {
    const target = join(testRoot, 'out.zip');
    const sourceError = Object.assign(new Error('ENOENT: no such file or directory, open /book.cbz'), { code: 'ENOENT' });
    const laterSource = vi.fn(() => chunkedStream('never reached'));

    const failing = writeZipArchive(target, [
      {
        name: 'pages/001.jpg',
        source: () => {
          const source = new PassThrough();
          process.nextTick(() => source.emit('error', sourceError));
          return source;
        },
      },
      { name: 'pages/002.jpg', source: laterSource },
    ]);

    await expect(failing).rejects.toThrow('ENOENT');
    expect(laterSource).not.toHaveBeenCalled();
  });

  it('rejects when the archive rejects an entry instead of hanging', async () => {
    const target = join(testRoot, 'out.zip');

    await expect(writeZipArchive(target, [{ name: '', source: Buffer.from('x') }])).rejects.toThrow(/ENTRYNAMEREQUIRED|entry name/i);
  });

  it('rejects when the output file cannot be opened', async () => {
    const target = join(testRoot, 'missing-directory', 'out.zip');

    await expect(writeZipArchive(target, [{ name: 'a.txt', source: Buffer.from('a') }])).rejects.toThrow(/ENOENT/);
  });

  it('releases the output stream when a source fails', async () => {
    const target = join(testRoot, 'out.zip');

    const failing = writeZipArchive(target, [
      {
        name: 'a.txt',
        source: () => {
          const source = new PassThrough();
          process.nextTick(() => source.emit('error', new Error('read failed')));
          return source;
        },
      },
    ]);

    await expect(failing).rejects.toThrow('read failed');
    await expect(rm(target, { force: true })).resolves.toBeUndefined();
  });
});
