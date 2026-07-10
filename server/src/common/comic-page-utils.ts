const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

export function isImagePage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

export function isHiddenPage(name: string): boolean {
  return name.split('/').some((p) => p.startsWith('.'));
}

export function naturalPageSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
