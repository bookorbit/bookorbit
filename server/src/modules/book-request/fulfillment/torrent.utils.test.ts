import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

import { infoHashFromMagnet, magnetDisplayName, torrentMetadataFromFile } from './torrent.utils';

const HEX_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';

function bencodeString(value: string): Buffer {
  return Buffer.from(`${Buffer.byteLength(value)}:${value}`, 'utf8');
}

/** A minimal single-file torrent: enough structure to exercise the span scanner. */
function torrentFile(name = 'dune.epub'): { buffer: Buffer; expectedHash: string } {
  const info = Buffer.concat([
    Buffer.from('d', 'utf8'),
    bencodeString('length'),
    Buffer.from('i1234e', 'utf8'),
    bencodeString('name'),
    bencodeString(name),
    bencodeString('piece length'),
    Buffer.from('i16384e', 'utf8'),
    bencodeString('pieces'),
    Buffer.from('20:', 'utf8'),
    Buffer.alloc(20, 7),
    Buffer.from('e', 'utf8'),
  ]);

  const buffer = Buffer.concat([
    Buffer.from('d', 'utf8'),
    bencodeString('announce'),
    bencodeString('https://tracker.example/announce'),
    bencodeString('info'),
    info,
    Buffer.from('e', 'utf8'),
  ]);

  return { buffer, expectedHash: createHash('sha1').update(info).digest('hex') };
}

function bencodeFileEntry(length: number, name: string): Buffer {
  return Buffer.concat([
    Buffer.from('d', 'utf8'),
    bencodeString('length'),
    Buffer.from(`i${length}e`, 'utf8'),
    bencodeString('path'),
    Buffer.concat([Buffer.from('l', 'utf8'), ...name.split('/').map(bencodeString), Buffer.from('e', 'utf8')]),
    Buffer.from('e', 'utf8'),
  ]);
}

function wrapInfo(info: Buffer): Buffer {
  return Buffer.concat([Buffer.from('d', 'utf8'), bencodeString('info'), info, Buffer.from('e', 'utf8')]);
}

function multiFileTorrent(): Buffer {
  return wrapInfo(
    Buffer.concat([
      Buffer.from('d', 'utf8'),
      bencodeString('files'),
      Buffer.concat([Buffer.from('l', 'utf8'), bencodeFileEntry(500, 'one.epub'), bencodeFileEntry(400, 'two.epub'), Buffer.from('e', 'utf8')]),
      bencodeString('name'),
      bencodeString('release'),
      Buffer.from('e', 'utf8'),
    ]),
  );
}

function sizelessTorrent(): Buffer {
  return wrapInfo(Buffer.concat([Buffer.from('d', 'utf8'), bencodeString('name'), bencodeString('release'), Buffer.from('e', 'utf8')]));
}

describe('infoHashFromMagnet', () => {
  it('reads a hex infohash and lowercases it', () => {
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${HEX_HASH.toUpperCase()}&dn=Dune`)).toBe(HEX_HASH);
  });

  it('converts a base32 infohash to hex', () => {
    const base32 = 'ZHQVOY7XELZD5GFCTXWN7LRUDOMNKMCW';
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${base32}`)).toBe(HEX_HASH);
  });

  it('skips a non-btih xt and keeps looking', () => {
    expect(infoHashFromMagnet(`magnet:?xt=urn:sha1:whatever&xt=urn:btih:${HEX_HASH}`)).toBe(HEX_HASH);
  });

  it('rejects a magnet with only a BitTorrent v2 hash, which qBittorrent would key differently', () => {
    expect(() => infoHashFromMagnet('magnet:?xt=urn:btmh:1220caf1e1c30e81cb361b9ee167c4aa64228a7fa4fa9f6105232b28ad099f3a302e')).toThrow(
      BadRequestException,
    );
  });

  it('rejects something that is not a magnet at all', () => {
    expect(() => infoHashFromMagnet('https://example.com/file.torrent')).toThrow(BadRequestException);
  });
});

describe('magnetDisplayName', () => {
  it('uses the display name when the magnet carries one', () => {
    expect(magnetDisplayName(`magnet:?xt=urn:btih:${HEX_HASH}&dn=Dune+%28retail%29`, 'fallback')).toBe('Dune (retail)');
  });

  it('falls back when there is no display name', () => {
    expect(magnetDisplayName(`magnet:?xt=urn:btih:${HEX_HASH}`, 'fallback')).toBe('fallback');
  });
});

describe('torrentMetadataFromFile', () => {
  it('hashes the raw info span rather than a re-encoded structure', () => {
    const { buffer, expectedHash } = torrentFile();
    expect(torrentMetadataFromFile(buffer)).toMatchObject({ infoHash: expectedHash, name: 'dune.epub', totalLength: 1234 });
  });

  /**
   * The size of what the release carries, not the size of the .torrent describing it. A multi-file
   * torrent states it only as a per-file list, so it has to be summed.
   */
  it('sums the file lengths of a multi-file torrent', () => {
    expect(torrentMetadataFromFile(multiFileTorrent()).totalLength).toBe(900);
  });

  it('returns the bounded file manifest with the torrent root', () => {
    expect(torrentMetadataFromFile(multiFileTorrent()).files).toEqual([
      { path: 'release/one.epub', length: 500 },
      { path: 'release/two.epub', length: 400 },
    ]);
  });

  it('returns a single-file torrent as a one-entry manifest', () => {
    expect(torrentMetadataFromFile(torrentFile().buffer).files).toEqual([{ path: 'dune.epub', length: 1234 }]);
  });

  it('rejects traversal in a manifest path', () => {
    const torrent = wrapInfo(
      Buffer.concat([
        Buffer.from('d', 'utf8'),
        bencodeString('files'),
        Buffer.concat([Buffer.from('l', 'utf8'), bencodeFileEntry(500, '../dune.epub'), Buffer.from('e', 'utf8')]),
        bencodeString('name'),
        bencodeString('release'),
        Buffer.from('e', 'utf8'),
      ]),
    );

    expect(() => torrentMetadataFromFile(torrent)).toThrow(BadRequestException);
  });

  it('rejects control characters in a manifest path', () => {
    const torrent = wrapInfo(
      Buffer.concat([
        Buffer.from('d', 'utf8'),
        bencodeString('files'),
        Buffer.concat([Buffer.from('l', 'utf8'), bencodeFileEntry(500, 'bad\nname.epub'), Buffer.from('e', 'utf8')]),
        bencodeString('name'),
        bencodeString('release'),
        Buffer.from('e', 'utf8'),
      ]),
    );

    expect(() => torrentMetadataFromFile(torrent)).toThrow(BadRequestException);
  });

  it('reports no size when the info dictionary states none', () => {
    expect(torrentMetadataFromFile(sizelessTorrent()).totalLength).toBeNull();
  });

  it('is unaffected by binary piece data that contains dictionary markers', () => {
    const { buffer, expectedHash } = torrentFile('e:de.epub');
    expect(torrentMetadataFromFile(buffer).infoHash).toBe(expectedHash);
  });

  it('rejects a file that is not a bencoded dictionary', () => {
    expect(() => torrentMetadataFromFile(Buffer.from('not a torrent'))).toThrow(BadRequestException);
  });

  it('rejects a dictionary with no info key', () => {
    const buffer = Buffer.concat([Buffer.from('d'), bencodeString('announce'), bencodeString('https://x/a'), Buffer.from('e')]);
    expect(() => torrentMetadataFromFile(buffer)).toThrow(BadRequestException);
  });

  it('rejects a truncated file rather than reading past the end', () => {
    const { buffer } = torrentFile();
    expect(() => torrentMetadataFromFile(buffer.subarray(0, buffer.length - 10))).toThrow(BadRequestException);
  });
});
