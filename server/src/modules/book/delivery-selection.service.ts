import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import type { DeliveryArtifactMetadata, ReadAloudDeliveryPreference } from '@bookorbit/types';
import { authConfig } from '../../config/config';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { openDeliveryStream } from './delivery-stream';
import { DeliveryHashRegistrationService } from './delivery-hash-registration.service';
import { DeliveryArtifactRepository } from './delivery-artifact.repository';
import { DeliveryArtifactService, DELIVERY_TRANSFORM_VERSION, type DeliveryArtifact, type DeliverySource } from './delivery-artifact.service';

@Injectable()
export class DeliverySelectionService {
  constructor(
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
    private readonly artifacts: DeliveryArtifactService,
    private readonly repository: DeliveryArtifactRepository,
    private readonly hashes: DeliveryHashRegistrationService,
  ) {}

  descriptor(userId: number, scope: string, fileId: number, variant: ReadAloudDeliveryPreference, contentVersion: string): string {
    const payload = Buffer.from(JSON.stringify([userId, scope, fileId, variant, contentVersion, DELIVERY_TRANSFORM_VERSION])).toString('base64url');
    return `${payload}.${createHmac('sha256', this.auth.jwtSecret).update(payload).digest('base64url')}`;
  }

  async metadata(userId: number, scope: string, descriptors: string[]) {
    if (!descriptors.length) return new Map<string, DeliveryArtifactMetadata>();
    const keys = descriptors.map((descriptor) => createHash('sha256').update(descriptor).digest('hex'));
    const rows = await this.repository.findMany(keys, userId, scope);
    const byKey = new Map(rows.map((row) => [row.selectionId, row.metadata]));
    return new Map(
      descriptors.flatMap((descriptor, index) => {
        const metadata = byKey.get(keys[index]);
        return metadata ? [[descriptor, metadata] as const] : [];
      }),
    );
  }

  async prepare(
    userId: number,
    scope: string,
    source: DeliverySource,
    variant: ReadAloudDeliveryPreference,
    descriptor?: string,
    contentVersion?: string,
    explicitOverride = true,
  ): Promise<DeliveryArtifact> {
    let selectionId: string | undefined;
    let policy = variant;
    if (descriptor) {
      const [payload, signature, extra] = descriptor.split('.');
      const expected = createHmac('sha256', this.auth.jwtSecret)
        .update(payload ?? '')
        .digest('base64url');
      if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
        throw new ForbiddenException();
      let values: unknown;
      try {
        values = JSON.parse(Buffer.from(payload, 'base64url').toString());
      } catch {
        throw new ForbiddenException();
      }
      if (!Array.isArray(values) || values[0] !== userId || values[1] !== scope || values[2] !== source.id) throw new ForbiddenException();
      if (![null, 'original', 'audioless_epub'].includes(values[3]) || (explicitOverride && values[3] !== variant)) throw new ForbiddenException();
      policy = values[3] as ReadAloudDeliveryPreference;
      if (values[5] !== DELIVERY_TRANSFORM_VERSION || (contentVersion && values[4] !== contentVersion))
        throw new ConflictException({ code: 'DELIVERY_SELECTION_EXPIRED' });
      selectionId = createHash('sha256').update(descriptor).digest('hex');
    }
    const captured = selectionId ? await this.repository.find(selectionId, userId, scope) : undefined;
    const artifact = await this.artifacts.prepare(
      source,
      captured?.metadata.actualVariant === 'original' ? 'original' : policy,
      captured?.metadata.sourceRevision,
    );
    try {
      if (captured) {
        if (artifact.sha256 !== captured.metadata.sha256 || artifact.format !== captured.metadata.format)
          throw new ConflictException({ code: 'DELIVERY_ARTIFACT_UNAVAILABLE' });
        return { ...artifact, ...captured.metadata };
      }
      if (selectionId) {
        const { path: artifactPath, release: artifactRelease, ...metadata } = artifact;
        void artifactPath;
        void artifactRelease;
        const sealed = await this.repository.seal(selectionId, userId, scope, source.id, metadata);
        if (!sealed || sealed.metadata.sha256 !== artifact.sha256) throw new ConflictException({ code: 'DELIVERY_ARTIFACT_UNAVAILABLE' });
      }
      await this.hashes.record(source.id, artifact.fileHash);
      return artifact;
    } catch (error) {
      await artifact.release();
      throw error;
    }
  }

  async stream(artifact: DeliveryArtifact, filename: string, mime: string, reply: FastifyReply, onReadComplete?: () => void): Promise<void> {
    try {
      const etag = `"${artifact.sha256}"`;
      const headers = reply.request?.headers ?? {};
      let start = 0;
      let end = artifact.sizeBytes - 1;
      let partial = false;
      if (headers.range && (!headers['if-range'] || headers['if-range'] === etag)) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(headers.range);
        if (range && (range[1] || range[2])) {
          if (!range[1]) start = Math.max(0, artifact.sizeBytes - Number(range[2]));
          else {
            start = Number(range[1]);
            if (range[2]) end = Math.min(end, Number(range[2]));
          }
        }
        if (
          !range ||
          (!range[1] && !range[2]) ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          (!range[1] && Number(range[2]) === 0) ||
          start >= artifact.sizeBytes
        ) {
          reply.header('Content-Range', `bytes */${artifact.sizeBytes}`);
          reply.status(416).send();
          await artifact.release();
          return;
        }
        partial = true;
      }
      const stream = await openDeliveryStream(artifact, start, end);
      if (reply.raw?.destroyed) {
        stream.destroy();
        return;
      }
      reply.header('Content-Disposition', contentDispositionHeader('attachment', filename, 'download'));
      reply.header('ETag', etag);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Cache-Control', 'private, no-transform');
      reply.header('Content-Encoding', 'identity');
      reply.header('X-BookOrbit-Artifact', artifact.artifactId);
      reply.header('X-BookOrbit-Variant', artifact.actualVariant);
      reply.header('X-BookOrbit-File-Hash', artifact.fileHash);
      reply.type(mime);
      if (partial) {
        reply.status(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${artifact.sizeBytes}`);
      }
      reply.header('Content-Length', Math.max(0, end - start + 1));
      if (onReadComplete) stream.once('end', onReadComplete);
      reply.raw?.once('close', () => stream.destroy());
      reply.send(stream);
    } catch (error) {
      await artifact.release();
      throw error;
    }
  }
}
