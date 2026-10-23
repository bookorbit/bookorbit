import fastifyCompress from '@fastify/compress';
import { CanActivate, ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZipArchive } from 'archiver';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { EpubMediaOverlayPlaylist } from '@bookorbit/types';
import type { RequestUser } from '../../../common/types/request-user';
import { registerDeclaredCompressionOptOuts } from '../../../common/utils/bootstrap.utils';
import { BookReadService } from '../../book/book-read.service';
import { LibraryService } from '../../library/library.service';
import { EpubController } from './epub.controller';
import { EpubService } from './epub.service';

const reader = { id: 7, username: 'reader', isSuperuser: false, permissions: [] } as unknown as RequestUser;

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ user: RequestUser }>().user = reader;
    return true;
  }
}

const bookReadService = {
  findLibraryIdByBookId: vi.fn(),
  findFileById: vi.fn(),
  findPrimaryFilesByBookIds: vi.fn(),
};

@Module({
  controllers: [EpubController],
  providers: [
    EpubService,
    { provide: BookReadService, useValue: bookReadService },
    { provide: LibraryService, useValue: { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } },
    { provide: APP_GUARD, useClass: StubAuthGuard },
  ],
})
class EpubAudioTestModule {}

function audioBytes(seed: number, length = 20_000): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index * 31 + seed * 7) % 251));
}

/** Each audio file, as the zip names it, how the OPF and SMIL refer to it, and how it is stored. */
const AUDIO = [
  { entry: 'OEBPS/Audio/chapter 1.mp4', href: 'Audio/chapter%201.mp4', inManifest: true, store: true, bytes: audioBytes(1) },
  { entry: 'OEBPS/Audio/50% off.mp4', href: 'Audio/50%25%20off.mp4', inManifest: true, store: false, bytes: audioBytes(2) },
  { entry: 'OEBPS/Audio/日本 語.mp4', href: 'Audio/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.mp4', inManifest: true, store: true, bytes: audioBytes(3) },
  { entry: 'OEBPS/Audio/unlisted.bin', href: 'Audio/unlisted.bin', inManifest: false, store: true, bytes: audioBytes(4) },
] as const;

async function writeNarratedEpub(path: string): Promise<void> {
  const manifestAudio = AUDIO.filter((audio) => audio.inManifest)
    .map((audio, index) => `<item id="audio-${index}" href="${audio.href}" media-type="audio/mp4"/>`)
    .join('\n    ');
  const pars = AUDIO.map(
    (audio, index) => `<par id="p${index}"><text src="../chapter.xhtml#s${index}"/><audio src="../${audio.href}" clipBegin="0s" clipEnd="1s"/></par>`,
  ).join('\n      ');
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  archive.append('application/epub+zip', { name: 'mimetype', store: true });
  archive.append(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    { name: 'META-INF/container.xml' },
  );
  archive.append(
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:narrated</dc:identifier><dc:title>Narrated</dc:title></metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay"/>
    <item id="overlay" href="MediaOverlays/chapter.smil" media-type="application/smil+xml"/>
    ${manifestAudio}
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`,
    { name: 'OEBPS/content.opf' },
  );
  archive.append('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter</p></body></html>', { name: 'OEBPS/chapter.xhtml' });
  archive.append(
    `<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0"><body><seq>
      ${pars}
    </seq></body></smil>`,
    { name: 'OEBPS/MediaOverlays/chapter.smil' },
  );
  for (const audio of AUDIO) archive.append(audio.bytes, { name: audio.entry, store: audio.store });
  await archive.finalize();
  await complete;
  await writeFile(path, Buffer.concat(chunks));
}

/** Percent-encodes each segment of a playlist href once, as the iOS player and reader both do. */
function requestPath(href: string): string {
  return `/epub/1/media-overlay/file/${href.split('/').map(encodeURIComponent).join('/')}`;
}

describe('media-overlay audio over HTTP', () => {
  let app: NestFastifyApplication;
  let root: string;
  let playlist: EpubMediaOverlayPlaylist;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-overlay-http-'));
    const epubPath = join(root, 'narrated.epub');
    await writeNarratedEpub(epubPath);
    bookReadService.findLibraryIdByBookId.mockResolvedValue(3);
    bookReadService.findPrimaryFilesByBookIds.mockResolvedValue([{ format: 'epub', absolutePath: epubPath, sizeBytes: null }]);

    const moduleFixture = await Test.createTestingModule({ imports: [EpubAudioTestModule] }).compile();
    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // As in production: the opt-out hook first, then compression for everything else.
    registerDeclaredCompressionOptOuts(app.getHttpAdapter().getInstance());
    await app.register(fastifyCompress as never, { encodings: ['gzip', 'br'] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({ method: 'GET', url: '/epub/1/media-overlay' });
    playlist = response.json();
  });

  afterAll(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('lists every audio file by its decoded name', () => {
    expect(playlist.resources.map((resource) => resource.href)).toEqual(AUDIO.map((audio) => audio.entry));
    expect(playlist.resources.map((resource) => resource.size)).toEqual(AUDIO.map((audio) => audio.bytes.length));
  });

  it.each(AUDIO.map((audio) => [audio.entry, audio] as const))('serves %s whole from a once-encoded request', async (_name, audio) => {
    const response = await app.inject({ method: 'GET', url: requestPath(audio.entry), headers: { 'accept-encoding': 'gzip, br' } });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['content-length']).toBe(String(audio.bytes.length));
    expect(response.headers['x-content-length-full']).toBe(String(audio.bytes.length));
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['cache-control']).toBe('private, max-age=3600');
    expect(response.headers['content-type']).toBe(audio.inManifest ? 'audio/mp4' : 'application/octet-stream');
    expect(response.rawPayload.equals(audio.bytes)).toBe(true);
  });

  it.each([
    ['a stored entry', AUDIO[0]],
    ['a deflated entry', AUDIO[1]],
  ])('serves a byte range of %s', async (_case, audio) => {
    const response = await app.inject({ method: 'GET', url: requestPath(audio.entry), headers: { range: 'bytes=12000-15999' } });

    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 12000-15999/${audio.bytes.length}`);
    expect(response.headers['content-length']).toBe('4000');
    expect(response.headers['x-content-length-full']).toBeUndefined();
    expect(response.rawPayload.equals(audio.bytes.subarray(12000, 16000))).toBe(true);
  });

  it('answers a range past the end with 416', async () => {
    const response = await app.inject({ method: 'GET', url: requestPath(AUDIO[0].entry), headers: { range: 'bytes=20000-' } });

    expect(response.statusCode).toBe(416);
    expect(response.headers['content-range']).toBe('bytes */20000');
    expect(response.headers['content-length']).toBe('0');
    expect(response.rawPayload.length).toBe(0);
  });

  it('does not decode the path a second time', async () => {
    const response = await app.inject({ method: 'GET', url: '/epub/1/media-overlay/file/OEBPS/Audio/chapter%25201.mp4' });

    expect(response.statusCode).toBe(404);
  });

  it('answers an open range past the end with 416 too', async () => {
    const response = await app.inject({ method: 'GET', url: requestPath(AUDIO[1].entry), headers: { range: 'bytes=25000-' } });

    expect(response.statusCode).toBe(416);
    expect(response.headers['content-range']).toBe('bytes */20000');
  });
});
