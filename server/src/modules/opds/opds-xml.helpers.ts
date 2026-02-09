export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function xmlEl(tag: string, text: string | null | undefined): string {
  return `<${tag}>${esc(text)}</${tag}>`;
}

export function xmlLink(rel: string, href: string, type: string, title?: string): string {
  const t = title ? ` title="${esc(title)}"` : '';
  return `<link rel="${esc(rel)}" href="${esc(href)}" type="${esc(type)}"${t}/>`;
}

export function fileMimeType(format: string): string {
  switch (format.toLowerCase()) {
    case 'epub':
      return 'application/epub+zip';
    case 'pdf':
      return 'application/pdf';
    case 'mobi':
      return 'application/x-mobipocket-ebook';
    case 'azw3':
      return 'application/vnd.amazon.ebook';
    case 'fb2':
      return 'application/x-fictionbook+xml';
    case 'cbz':
      return 'application/vnd.comicbook+zip';
    case 'cbr':
      return 'application/vnd.comicbook-rar';
    default:
      return 'application/octet-stream';
  }
}

export const OPDS_MIME_NAV = 'application/atom+xml;profile=opds-catalog;kind=navigation';
export const OPDS_MIME_ACQ = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
export const OPDS_MIME_SEARCH = 'application/opensearchdescription+xml';
