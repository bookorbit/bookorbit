/**
 * EPUB chapters are parsed in XML mode, which resolves only the five predefined
 * XML entities and numeric character references. EPUB2 XHTML may use any named
 * HTML entity through its DTD (`&nbsp;`, `&shy;`, `&mdash;`, ...), and every real
 * renderer resolves them: browsers, crengine, and kepubify (which re-serializes
 * them as literal characters). Leaving them as literal text would make a chapter's
 * text index disagree with its own kepub and with the rendered document, so they
 * are resolved on the raw markup before parsing.
 *
 * Resolving must happen before parsing, not on the parsed text nodes: `&nbsp;` and
 * `&amp;nbsp;` both parse to the text `&nbsp;`, so afterwards the two are
 * indistinguishable and escaped markup would be corrupted.
 */

import * as cheerio from 'cheerio';

/** CDATA sections keep entity references literal, so they are passed through whole. */
const CDATA_OR_NAMED_ENTITY_RE = /<!\[CDATA\[[\s\S]*?\]\]>|&[a-zA-Z][a-zA-Z0-9]*;/g;

const MARKUP_SIGNIFICANT_RE = /[<>&"']/;

/** Longest reference in the HTML named character table is `&CounterClockwiseContourIntegral;`. */
const MAX_REFERENCE_LENGTH = 34;

/** Bounded by the named character table, since longer candidates are never looked up. */
const resolvedByReference = new Map<string, string | null>();

/** Resolves one `&name;` reference, or null when it must be left to the XML parser. */
function resolveReference(reference: string): string | null {
  const cached = resolvedByReference.get(reference);
  if (cached !== undefined) return cached;

  // Cheerio's default HTML mode carries the full named character table, and reading
  // the reference back from an attribute value applies HTML's strict matching: an
  // unknown reference stays intact rather than partially matching a legacy entity,
  // so `&notanentity;` does not become `¬anentity;`. The pattern above admits only
  // ASCII alphanumerics and a trailing semicolon, so inlining it here cannot escape
  // the attribute.
  const text = cheerio.load(`<i data-reference="${reference}"></i>`)('i').attr('data-reference') ?? reference;
  const resolved = text === reference || text.length === 0 || MARKUP_SIGNIFICANT_RE.test(text) ? null : text;
  resolvedByReference.set(reference, resolved);
  return resolved;
}

/**
 * Resolves named HTML entity references in XHTML markup to their characters.
 * References the XML parser already handles are left untouched, as are references
 * whose character is markup-significant (`&amp;`, `&lt;`, and case aliases such as
 * `&LT;`), so resolving can never introduce markup or break an escaped sequence.
 */
export function decodeNamedEntities(markup: string): string {
  return markup.replace(CDATA_OR_NAMED_ENTITY_RE, (match) => {
    if (match.startsWith('<') || match.length > MAX_REFERENCE_LENGTH) return match;
    return resolveReference(match) ?? match;
  });
}
