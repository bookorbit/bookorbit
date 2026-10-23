import { createHash } from 'crypto';
import { open } from 'fs/promises';
import { Readable } from 'stream';
import { ConflictException } from '@nestjs/common';
import { deliveryFileSignature, type DeliveryArtifact } from './delivery-artifact.service';

export async function openDeliveryStream(artifact: DeliveryArtifact, start = 0, end = artifact.sizeBytes - 1): Promise<Readable> {
  const handle = await open(artifact.path, 'r');
  try {
    const before = await handle.stat();
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) digest.update(chunk);
    if (
      before.size !== artifact.sizeBytes ||
      digest.digest('hex') !== artifact.sha256 ||
      deliveryFileSignature(before) !== deliveryFileSignature(await handle.stat())
    )
      throw new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' });
    const source = handle.createReadStream({ start, ...(artifact.sizeBytes ? { end } : {}), autoClose: false });
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const chunk of source) {
            if (deliveryFileSignature(before) !== deliveryFileSignature(await handle.stat()))
              throw new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' });
            yield chunk;
          }
          if (deliveryFileSignature(before) !== deliveryFileSignature(await handle.stat()))
            throw new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' });
        } finally {
          source.destroy();
          await handle.close();
        }
      })(),
    );
    stream.once('close', () => {
      source.destroy();
      void handle.close().catch(() => {});
      void artifact.release();
    });
    return stream;
  } catch (error) {
    await handle.close().catch(() => {});
    await artifact.release();
    throw error;
  }
}
