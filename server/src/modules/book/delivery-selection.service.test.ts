import { PassThrough } from 'stream';
import type { FastifyReply } from 'fastify';
import { openDeliveryStream } from './delivery-stream';
import { Test } from '@nestjs/testing';
import { authConfig } from '../../config/config';
import { DeliveryArtifactService, DELIVERY_TRANSFORM_VERSION } from './delivery-artifact.service';
import { DeliveryArtifactRepository } from './delivery-artifact.repository';
import { DeliveryHashRegistrationService } from './delivery-hash-registration.service';
import { DeliverySelectionService } from './delivery-selection.service';

vi.mock('./delivery-stream', () => ({ openDeliveryStream: vi.fn() }));

describe('DeliverySelectionService', () => {
  let service: DeliverySelectionService;
  const release = vi.fn().mockResolvedValue(undefined);
  const metadata = {
    artifactId: 'artifact',
    sourceRevision: 'source-digest',
    requestedVariant: null,
    actualVariant: 'original',
    format: 'epub',
    sizeBytes: 42,
    sha256: 'full-digest',
    fileHash: 'fingerprint',
    outcome: 'legacy_fallback',
  } as const;
  const artifacts = { prepare: vi.fn() };
  const repository = { find: vi.fn(), seal: vi.fn(), findMany: vi.fn() };
  const hashes = { record: vi.fn() };
  const source = { id: 7, absolutePath: 'library/book.epub', format: 'epub' };
  beforeEach(async () => {
    vi.resetAllMocks();
    release.mockResolvedValue(undefined);
    artifacts.prepare.mockResolvedValue({ ...metadata, path: 'library/book.epub', release });
    repository.seal.mockResolvedValue({ metadata });
    const module = await Test.createTestingModule({
      providers: [
        DeliverySelectionService,
        { provide: authConfig.KEY, useValue: { jwtSecret: 'delivery-test-signing-key' } },
        { provide: DeliveryArtifactService, useValue: artifacts },
        { provide: DeliveryArtifactRepository, useValue: repository },
        { provide: DeliveryHashRegistrationService, useValue: hashes },
      ],
    }).compile();
    service = module.get(DeliverySelectionService);
  });

  it('keeps an issued inherited policy after the destination preference changes', async () => {
    const descriptor = service.descriptor(1, 'opds:2', 7, null, 'source-version');
    await service.prepare(1, 'opds:2', source, 'audioless_epub', descriptor, 'source-version', false);
    expect(artifacts.prepare).toHaveBeenCalledWith(source, null, undefined);
    expect(repository.seal).toHaveBeenCalledWith(expect.any(String), 1, 'opds:2', 7, metadata);
  });

  it('retries a sealed original fallback without rebuilding a different outcome', async () => {
    repository.find.mockResolvedValue({ metadata });
    const descriptor = service.descriptor(1, 'opds:2', 7, null, 'source-version');
    const result = await service.prepare(1, 'opds:2', source, 'audioless_epub', descriptor, 'source-version', false);
    expect(artifacts.prepare).toHaveBeenCalledWith(source, 'original', 'source-digest');
    expect(result.outcome).toBe('legacy_fallback');
    expect(result.requestedVariant).toBeNull();
  });

  it('rejects changed historical bytes and releases their lease', async () => {
    repository.find.mockResolvedValue({ metadata: { ...metadata, sha256: 'different-digest' } });
    const descriptor = service.descriptor(1, 'koreader', 7, 'original', 'source-version');
    await expect(service.prepare(1, 'koreader', source, 'original', descriptor, 'source-version')).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects mismatched account, profile, source version, and explicit policy before preparation', async () => {
    const descriptor = service.descriptor(1, 'opds:2', 7, 'original', 'source-version');
    for (const args of [
      [2, 'opds:2', 'original', 'source-version'],
      [1, 'opds:3', 'original', 'source-version'],
      [1, 'opds:2', 'original', 'changed-version'],
      [1, 'opds:2', 'audioless_epub', 'source-version'],
    ] as const) {
      await expect(service.prepare(args[0], args[1], source, args[2], descriptor, args[3])).rejects.toThrow();
    }
    expect(artifacts.prepare).not.toHaveBeenCalled();
    expect(DELIVERY_TRANSFORM_VERSION).toBeTruthy();
  });

  it('releases a prepared stream when its client disconnected before headers', async () => {
    const stream = new PassThrough();
    stream.once('close', () => void release());
    vi.mocked(openDeliveryStream).mockResolvedValue(stream);
    const reply = { raw: { destroyed: true }, request: { headers: {} }, header: vi.fn(), send: vi.fn() };
    await service.stream({ ...metadata, path: 'library/book.epub', release }, 'book.epub', 'application/epub+zip', reply as unknown as FastifyReply);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stream.destroyed).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    expect(reply.header).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});
