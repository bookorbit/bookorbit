import * as unzipper from 'unzipper';

export function attr(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

export function toRecordArray(val: unknown): Record<string, unknown>[] {
  if (Array.isArray(val)) return val as Record<string, unknown>[];
  if (val != null && typeof val === 'object') return [val as Record<string, unknown>];
  return [];
}

export function resolvePath(base: string, rel: string): string {
  const parts = (base + rel).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

/** Case-insensitive lookup of a manifest href inside an EPUB zip, resolved against the OPF directory. */
export function findInZip(zip: unzipper.CentralDirectory, rawHref: string, opfDir: string): unzipper.File | undefined {
  const decoded = decodeURIComponent(rawHref);
  const candidates = [resolvePath(opfDir, decoded), resolvePath(opfDir, rawHref), decoded, rawHref];
  const lower = candidates.map((c) => c.toLowerCase());
  return zip.files.find((f) => {
    const p = f.path.startsWith('/') ? f.path.slice(1) : f.path;
    return candidates.includes(p) || lower.includes(p.toLowerCase());
  });
}
