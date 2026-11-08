import { normalizeTitleText } from '../../common/text-match/title-match';

const MAX_TEXT_LENGTH = 512;
const APOSTROPHES = /['‘’ʼ`]/g;

export interface HardcoverBookIdentity {
  title?: string | null;
  subtitle?: string | null;
  cached_contributors?: unknown;
}

/**
 * Whether a Hardcover search hit is the local book. A title search is only a way to find candidates:
 * ranking alone must never decide the link, because it also returns loosely related books.
 *
 * The title has to be the same title, not a prefix of it. Volumes and sub-series share a stem
 * ("Samurai Jack: Volume 1" and "Samurai Jack: Volume 2"), so the text after a subtitle separator is
 * part of what is compared. The author may be any contributor whatever the role, because the local
 * author is one name picked from the book and can be its artist rather than its writer.
 */
export function matchesTitleAndAuthor(candidate: HardcoverBookIdentity, localTitle: string, localAuthor: string): boolean {
  const wantedTitle = normalizeText(localTitle);
  if (!wantedTitle) return false;
  if (!candidateTitleForms(candidate).includes(wantedTitle)) return false;

  const wantedAuthor = tokenize(localAuthor);
  if (wantedAuthor.length === 0) return false;
  return extractContributorNames(candidate.cached_contributors).some((name) => sameName(wantedAuthor, tokenize(name)));
}

function candidateTitleForms(candidate: HardcoverBookIdentity): string[] {
  const title = normalizeText(candidate.title ?? '');
  if (!title) return [];
  const subtitle = normalizeText(candidate.subtitle ?? '');
  return subtitle ? [title, `${title} ${subtitle}`] : [title];
}

// Equal token sets, or one name carrying extra tokens such as a middle initial. A single token never
// matches a longer name, so "Smith" does not match every Smith.
function sameName(left: string[], right: string[]): boolean {
  const leftTokens = new Set(left);
  const rightTokens = new Set(right);
  const [smaller, larger] = leftTokens.size <= rightTokens.size ? [leftTokens, rightTokens] : [rightTokens, leftTokens];
  if (smaller.size === 0) return false;
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return smaller.size === larger.size || smaller.size >= 2;
}

function extractContributorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const nested = (entry as { author?: { name?: unknown } | null }).author?.name;
    const name = typeof nested === 'string' ? nested : (entry as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim().length > 0) names.push(name);
  }
  return names;
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ') : [];
}

// Over-long text normalizes to nothing and so never matches, instead of being cut to a prefix that
// two different titles could share.
function normalizeText(value: string): string {
  if (value.length > MAX_TEXT_LENGTH) return '';
  return normalizeTitleText(value.replace(APOSTROPHES, '').replace(/&/g, ' and '));
}
