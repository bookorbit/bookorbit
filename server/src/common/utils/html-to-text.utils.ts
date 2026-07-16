import { load } from 'cheerio';

type HtmlToTextOptions = {
  preserveLineBreaks?: boolean;
};

const BLOCK_ELEMENTS =
  'address,article,aside,blockquote,div,dl,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tr,ul';

export function htmlToPlainText(html: string, options: HtmlToTextOptions = {}): string {
  const $ = load(html, undefined, false);
  $('script,style,noscript,template').remove();

  if (options.preserveLineBreaks) {
    $('br').replaceWith('\n');
    $(BLOCK_ELEMENTS).each((_index, element) => {
      $(element).append('\n');
    });
  }

  const text = stripAngleBracketMarkup($.root().text());
  if (!options.preserveLineBreaks) return text.replace(/\s+/g, ' ').trim();

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripAngleBracketMarkup(value: string): string {
  let result = '';
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf('<', cursor);
    if (start < 0) return result + value.slice(cursor);
    result += value.slice(cursor, start);

    const end = value.indexOf('>', start + 1);
    if (end < 0) return result + value.slice(start).replace(/[<>]/g, '');
    cursor = end + 1;
  }

  return result;
}
