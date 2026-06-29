type ContentDispositionType = 'attachment' | 'inline';

function stripLoneSurrogates(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += value[i];
  }
  return out;
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
  const asciiFallback = fallbackFilename.replace(/[^\x20-\x7E]|["\\]/g, '_') || 'download';
  const asciiFilename = filename.replace(/[^\x20-\x7E]|["\\]/g, '_') || asciiFallback;
  const encodedFilename = encodeFilenameStar(filename);
  const disposition = `${type}; filename="${asciiFilename}"`;

  return encodedFilename ? `${disposition}; filename*=UTF-8''${encodedFilename}` : disposition;
}
