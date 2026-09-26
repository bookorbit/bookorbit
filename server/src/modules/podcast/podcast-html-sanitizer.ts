import * as cheerio from 'cheerio';

const ALLOWED_TAGS = new Set(['a', 'b', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4', 'hr', 'i', 'li', 'ol', 'p', 'pre', 'strong', 'ul']);

export function sanitizePodcastHtml(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const $ = cheerio.load(value, null, false);
  $('script,style,iframe,object,embed,form,input,button,svg,math').remove();
  $('*').each((_, element) => {
    if (!('tagName' in element) || !('attribs' in element)) return;
    const node = $(element);
    const tagName = element.tagName?.toLowerCase();
    if (!tagName || !ALLOWED_TAGS.has(tagName)) {
      node.replaceWith(node.contents());
      return;
    }
    for (const attribute of Object.keys(element.attribs ?? {})) {
      if (tagName === 'a' && attribute === 'href') continue;
      node.removeAttr(attribute);
    }
    if (tagName === 'a') {
      const href = node.attr('href');
      if (!href || !/^https?:\/\//i.test(href)) node.removeAttr('href');
      else node.attr('rel', 'noopener noreferrer').attr('target', '_blank');
    }
  });
  return $.html().trim() || null;
}

export function podcastHtmlToText(value: string | null | undefined): string | null {
  const sanitized = sanitizePodcastHtml(value);
  if (!sanitized) return null;
  const text = cheerio.load(sanitized)('body').text().replace(/\s+/g, ' ').trim();
  return text || null;
}
