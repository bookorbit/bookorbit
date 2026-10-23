import { createHash } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { openDeliveryStream } from './delivery-stream';
import type { DeliveryArtifact } from './delivery-artifact.service';

describe('delivery stream byte stability', () => {
  let root: string;
  let artifact: DeliveryArtifact;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'delivery-stream-'));
    const path = join(root, 'book.epub');
    const content = Buffer.alloc(256 * 1024, 17);
    await writeFile(path, content);
    artifact = {
      path,
      release: vi.fn(() => Promise.resolve()),
      artifactId: 'artifact',
      sourceRevision: 'revision',
      requestedVariant: 'original',
      actualVariant: 'original',
      outcome: 'original',
      format: 'epub',
      sizeBytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      fileHash: 'fingerprint',
    };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads the requested range from the validated handle and releases its lease', async () => {
    const stream = await openDeliveryStream(artifact, 100, 199);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual((await readFile(artifact.path)).subarray(100, 200));
    expect(artifact.release).toHaveBeenCalledOnce();
  });

  it('rejects same-length replacement before returning a stream', async () => {
    await writeFile(artifact.path, Buffer.alloc(artifact.sizeBytes, 18));
    await expect(openDeliveryStream(artifact)).rejects.toThrow();
    expect(artifact.release).toHaveBeenCalledOnce();
  });

  it('fails an in-place write during streaming instead of publishing mixed revisions', async () => {
    const stream = await openDeliveryStream(artifact);
    let changed = false;
    await expect(
      (async () => {
        for await (const chunk of stream) {
          expect(chunk).toBeInstanceOf(Buffer);
          if (!changed) {
            changed = true;
            await writeFile(artifact.path, Buffer.alloc(artifact.sizeBytes, 19));
          }
        }
      })(),
    ).rejects.toThrow();
    expect(artifact.release).toHaveBeenCalledOnce();
  });

  it('releases a stream abandoned before its first read', async () => {
    const stream = await openDeliveryStream(artifact);
    const closed = new Promise<void>((resolve) => stream.once('close', resolve));
    stream.destroy();
    await closed;
    expect(artifact.release).toHaveBeenCalledOnce();
  });
});
