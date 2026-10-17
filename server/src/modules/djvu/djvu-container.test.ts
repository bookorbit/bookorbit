import { mkdtemp, open, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { djvuBundleFixture, djvuPageFixture } from '../../../test/e2e/djvu-fixture';
import { validateDjvuContainer } from './djvu-container';

describe('DjVu container containment', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'djvu-container-test-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function validate(buffer: Buffer) {
    const path = join(directory, 'document.djvu');
    await writeFile(path, buffer);
    const handle = await open(path, 'r');
    try {
      return await validateDjvuContainer(handle, buffer.length);
    } finally {
      await handle.close();
    }
  }

  it('accepts standalone and bundled pages', async () => {
    expect(await validate(djvuPageFixture())).toBe(1);
    expect(await validate(djvuBundleFixture())).toBe(2);
  });

  it('accepts bytes after the top-level form, which DjVuLibre ignores', async () => {
    expect(await validate(Buffer.concat([djvuPageFixture(), Buffer.alloc(3)]))).toBe(1);
  });

  it('rejects a top-level form that claims more bytes than the file holds', async () => {
    const buffer = djvuPageFixture();
    buffer.writeUInt32BE(buffer.length, 8);
    await expect(validate(buffer)).rejects.toMatchObject({ status: 422 });
  });

  it('rejects indirect document directories', async () => {
    const buffer = djvuBundleFixture();
    buffer[24] = 1;
    await expect(validate(buffer)).rejects.toMatchObject({ status: 422 });
  });

  it('rejects directory offsets into unvalidated payloads', async () => {
    const buffer = djvuBundleFixture();
    buffer.writeUInt32BE(80, 27);
    await expect(validate(buffer)).rejects.toMatchObject({ status: 422 });
  });

  it.each(['../secret', '/path/to/component', 'file:///secret', 'https://example.com/component', 'dictionary'])(
    'rejects standalone references: %s',
    async (name) => {
      const source = djvuPageFixture();
      const ref = Buffer.from(name);
      const chunk = Buffer.alloc(8 + ref.length);
      chunk.write('INCL');
      chunk.writeUInt32BE(ref.length, 4);
      ref.copy(chunk, 8);
      const buffer = Buffer.concat([source, Buffer.alloc(1), chunk]);
      buffer.writeUInt32BE(buffer.length - 12, 8);
      await expect(validate(buffer)).rejects.toMatchObject({ status: 422 });
    },
  );

  it('rejects source dimensions that exceed the decode bound', async () => {
    const buffer = djvuPageFixture();
    buffer.writeUInt16BE(65535, 24);
    buffer.writeUInt16BE(65535, 26);
    await expect(validate(buffer)).rejects.toMatchObject({ status: 422 });
  });

  it('rejects malformed sizes and truncated chunks', async () => {
    await expect(validate(Buffer.from('not djvu'))).rejects.toMatchObject({ status: 422 });
    const buffer = djvuPageFixture().subarray(0, 60);
    buffer.writeUInt32BE(buffer.length - 12, 8);
    await expect(validate(buffer)).rejects.toMatchObject({ status: 422 });
  });
});
