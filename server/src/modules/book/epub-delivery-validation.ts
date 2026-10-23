import { posix } from 'path';
import { BadRequestException } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type * as unzipper from 'unzipper';

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, htmlEntities: true });
const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const invalid = (reason: string): never => {
  throw new BadRequestException({ code: 'UNSUPPORTED_TEXT_ONLY_EPUB', message: reason });
};

function overlaySources(doc: unknown): { audio: string[]; text: string[] } {
  const resources: { audio: string[]; text: string[] } = { audio: [], text: [] };
  const pending: unknown[] = [doc];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const item of node) pending.push(item);
      continue;
    }
    for (const [tag, value] of Object.entries(node)) {
      if (tag === 'audio' || tag === 'text') {
        for (const item of asArray(value)) {
          const src = item && typeof item === 'object' ? (item as Record<string, unknown>)['@_src'] : undefined;
          if (typeof src === 'string') resources[tag].push(src);
        }
      }
      if (!tag.startsWith('@_')) pending.push(value);
    }
  }
  return resources;
}

export function safeEpubEntryKey(name: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return invalid('Invalid archive name encoding');
  }
  if (/^[a-z][a-z\d+.-]*:|^[/\\]|[\\\0]/i.test(decoded) || decoded.split('/').some((part) => part === '..')) {
    return invalid('Unsafe archive entry');
  }
  return posix.normalize(decoded).replace(/\/$/, '').normalize('NFC').toLowerCase();
}

export async function readEpubEntry(entry: unzipper.File, maxBytes: number): Promise<Buffer> {
  if (entry.uncompressedSize > maxBytes) return invalid('EPUB resource exceeds inspection limit');
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = entry.stream();
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      if (size > maxBytes) return invalid('EPUB resource exceeds inflated inspection limit');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
}

export function validateEpubEntries(files: unzipper.File[], maxEntries: number): Map<string, unzipper.File> {
  if (files.length > maxEntries) return invalid('Too many EPUB entries');
  const entries = new Map<string, unzipper.File>();
  for (const file of files) {
    const key = safeEpubEntryKey(file.path);
    if (!key || entries.has(key)) return invalid('Ambiguous archive entries');
    entries.set(key, file);
  }
  return entries;
}

export async function inspectDeliveryEpub(zip: unzipper.CentralDirectory, maxEntries: number, maxXmlBytes: number): Promise<boolean> {
  const entries = validateEpubEntries(zip.files, maxEntries);
  const xml = async (key: string) => {
    const entry = entries.get(key);
    if (!entry) return invalid('Missing EPUB resource');
    const content = (await readEpubEntry(entry, maxXmlBytes)).toString('utf8');
    if (/<!ENTITY/i.test(content) || XMLValidator.validate(content) !== true) return invalid('Invalid EPUB XML');
    return { content, doc: parser.parse(content) };
  };
  if (entries.has('meta-inf/signatures.xml')) return invalid('Signed EPUB cannot be transformed');
  if (entries.has('meta-inf/encryption.xml')) {
    const { content } = await xml('meta-inf/encryption.xml');
    const algorithms = [...content.matchAll(/Algorithm=["']([^"']+)/g)].map((match) => match[1]);
    if (!algorithms.length || algorithms.some((value) => !['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'].includes(value))) {
      return invalid('Encrypted EPUB cannot be transformed');
    }
  }
  const { doc: container } = await xml('meta-inf/container.xml');
  const roots = asArray<Record<string, string>>(container?.container?.rootfiles?.rootfile);
  if (roots.length !== 1) return invalid('Only single-package EPUBs are supported');
  const opfKey = safeEpubEntryKey(roots[0]['@_full-path'] ?? '');
  const { doc } = await xml(opfKey);
  const items = asArray<Record<string, string>>(doc?.package?.manifest?.item);
  const ids = new Map<string, Record<string, string>>();
  const resolve = (href: string, base: string): string => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(href.split(/[?#]/)[0]);
    } catch {
      return invalid('Invalid resource href');
    }
    if (/^[a-z][a-z\d+.-]*:|^[/\\]|[\\\0]/i.test(decoded)) return invalid('Non-local EPUB resource');
    const joined = posix.join(posix.dirname(base), decoded);
    if (joined.startsWith('../')) return invalid('Resource escapes EPUB');
    return safeEpubEntryKey(joined);
  };
  if (!items.length) return invalid('Missing EPUB manifest');
  for (const item of items) {
    const id = item['@_id'];
    if (!id || ids.has(id)) return invalid('Ambiguous manifest IDs');
    ids.set(id, item);
    if (!entries.has(resolve(item['@_href'] ?? '', opfKey))) return invalid('Missing manifest resource');
    if (/video\//i.test(item['@_media-type'] ?? '')) return invalid('Mixed multimedia EPUB is unsupported');
  }
  const spine = asArray<Record<string, string>>(doc?.package?.spine?.itemref);
  if (!spine.length || spine.some((item) => !ids.has(item['@_idref']))) return invalid('Invalid EPUB spine');
  const overlayItems = items.filter((item) => item['@_media-overlay']);
  const audioPaths = new Set(items.filter((item) => /^audio\//i.test(item['@_media-type'] ?? '')).map((item) => resolve(item['@_href'], opfKey)));
  const declared = new Set(items.map((item) => resolve(item['@_href'], opfKey)));
  for (const key of entries.keys()) {
    if (/\.(?:smil|mp3|m4a|m4b|aac|ogg|opus|wav|flac|mp4|webm)$/i.test(key) && !declared.has(key))
      return invalid('Undeclared multimedia is unsupported');
  }
  const overlayAudio = new Set<string>();
  for (const item of overlayItems) {
    const smil = ids.get(item['@_media-overlay']);
    if (smil?.['@_media-type'] !== 'application/smil+xml') return invalid('Invalid media overlay graph');
    const smilKey = resolve(smil['@_href'], opfKey);
    const { doc: smilDoc } = await xml(smilKey);
    const { audio, text } = overlaySources(smilDoc);
    if (!audio.length || !text.length) return invalid('Incomplete media overlay');
    for (const href of [...audio, ...text]) if (!entries.has(resolve(href, smilKey))) return invalid('Missing overlay resource');
    const textTargets = new Map<string, Set<string>>();
    for (const href of text) {
      const key = resolve(href, smilKey);
      const encodedFragment = href.split('#')[1];
      if (!encodedFragment) continue;
      let fragment: string;
      try {
        fragment = decodeURIComponent(encodedFragment);
      } catch {
        return invalid('Invalid overlay fragment');
      }
      const targets = textTargets.get(key) ?? new Set<string>();
      targets.add(fragment);
      textTargets.set(key, targets);
    }
    for (const [key, targets] of textTargets) {
      const { doc: textDoc } = await xml(key);
      const pending: unknown[] = [textDoc];
      while (pending.length && targets.size) {
        const node = pending.pop();
        if (!node || typeof node !== 'object') continue;
        for (const [name, value] of Object.entries(node)) {
          if (name === '@_id' && typeof value === 'string') targets.delete(value);
          else if (!name.startsWith('@_')) pending.push(value);
        }
      }
      if (targets.size) return invalid('Missing overlay text target');
    }
    for (const href of audio) overlayAudio.add(resolve(href, smilKey));
  }
  if ([...overlayAudio].some((key) => !audioPaths.has(key))) return invalid('Undeclared overlay audio is unsupported');
  if ([...audioPaths].some((key) => !overlayAudio.has(key))) return invalid('Audio outside media overlays is unsupported');
  for (const item of items.filter((item) => /(?:xhtml|svg|css)/i.test(item['@_media-type'] ?? ''))) {
    const content = (await readEpubEntry(entries.get(resolve(item['@_href'], opfKey))!, maxXmlBytes)).toString('utf8');
    if (/<(?:\w+:)?(?:audio|video|object|embed)\b/i.test(content)) return invalid('Embedded multimedia is unsupported');
    for (const path of audioPaths) {
      if (content.includes(posix.basename(path))) return invalid('Audio referenced outside media overlays');
    }
  }
  return overlayItems.length > 0;
}
