import { extname } from 'path';

const IMAGE_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

export function imageContentTypeFromPath(path: string): string {
  return imageContentTypeFromExtension(extname(path));
}

export function imageContentTypeFromExtension(extension: string): string {
  return IMAGE_CONTENT_TYPE_BY_EXT[extension.toLowerCase()] ?? 'image/jpeg';
}
