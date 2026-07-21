type ContentDispositionType = 'attachment' | 'inline';
const MAX_HEADER_FILENAME_CODE_UNITS = 1024;

function stripLoneSurrogates(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint >= 0xd800 && codePoint <= 0xdfff ? '' : character;
  }).join('');
}

function boundedHeaderValue(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_HEADER_FILENAME_CODE_UNITS) : '';
}

function encodeFilenameStar(value: string): string | null {
  try {
    const cleaned = stripLoneSurrogates(value);
    if (!cleaned) return null;
    return encodeURIComponent(cleaned).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return null;
  }
}

export function contentDispositionHeader(type: ContentDispositionType, filename: string, fallbackFilename: string): string {
  const boundedFilename = boundedHeaderValue(filename);
  const boundedFallback = boundedHeaderValue(fallbackFilename);
  const asciiFallback = boundedFallback.replace(/[^\x20-\x7E]|["\\]/g, '_') || 'download';
  const asciiFilename = boundedFilename.replace(/[^\x20-\x7E]|["\\]/g, '_') || asciiFallback;
  const encodedFilename = encodeFilenameStar(boundedFilename);
  const disposition = `${type}; filename="${asciiFilename}"`;

  return encodedFilename ? `${disposition}; filename*=UTF-8''${encodedFilename}` : disposition;
}
