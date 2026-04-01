const ARCHIVE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

export function isArchiveImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && ARCHIVE_IMAGE_EXTENSIONS.has(name.substring(dot).toLowerCase());
}

export function isHiddenArchivePath(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'));
}
