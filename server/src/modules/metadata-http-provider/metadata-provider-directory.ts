import { EXTERNAL_METADATA_PROVIDER_KEY_PATTERN, type MetadataHttpProviderMediaType, type MetadataProviderDirectoryEntry } from '@bookorbit/types';

const REPOSITORY = 'https://github.com/bookorbit/bookorbit-metadata-providers';
const MAX_ENTRIES = 100;
const MAX_LANGUAGES = 10;
const MEDIA_TYPES: readonly MetadataHttpProviderMediaType[] = ['book', 'audiobook', 'comic'];
const IMAGE_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;
const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function entry(
  key: string,
  name: string,
  summary: string,
  color: string,
  mediaTypes: MetadataHttpProviderMediaType[],
  languages: string[],
  homepage: string,
): MetadataProviderDirectoryEntry {
  return {
    key,
    name,
    summary,
    image: `ghcr.io/bookorbit/${key}-provider`,
    version: '0.1.0',
    port: 8080,
    docsUrl: `${REPOSITORY}/tree/main/providers/${key}`,
    homepage,
    color,
    mediaTypes,
    languages,
  };
}

/**
 * The list as it stood when this build was made. Shown when the online list is turned off or cannot
 * be read, so the tab never comes up empty. Keep it in step with `directory.json` in the repository.
 */
export const BUNDLED_PROVIDER_DIRECTORY: readonly MetadataProviderDirectoryEntry[] = [
  entry(
    'douban',
    'Douban',
    'Chinese books from Douban: titles, authors, publishers, ratings and ISBN lookups. Covers are not available.',
    '#13bc39',
    ['book'],
    ['zh'],
    'https://book.douban.com',
  ),
  entry(
    'fantlab',
    'FantLab',
    'Russian-language science fiction and fantasy from FantLab: works, editions by ISBN, series, genres and ratings.',
    '#2c98cd',
    ['book'],
    ['ru'],
    'https://fantlab.ru',
  ),
  entry(
    'jnovelclub',
    'J-Novel Club',
    "Light novels and manga published in English by J-Novel Club. Reads the volume number from the book's title.",
    '#0057a8',
    ['book', 'comic'],
    ['en'],
    'https://j-novel.club',
  ),
  entry(
    'libris',
    'Libris',
    "Swedish books and audiobooks from Libris, the National Library of Sweden's catalogue.",
    '#8db83e',
    ['book', 'audiobook'],
    ['sv'],
    'https://libris.kb.se',
  ),
  entry(
    'lubimyczytac',
    'LubimyCzytac',
    'Polish books from LubimyCzytac: titles, authors, series, genres and ratings.',
    '#ff5500',
    ['book', 'audiobook', 'comic'],
    ['pl'],
    'https://lubimyczytac.pl',
  ),
  entry(
    'mangabaka',
    'MangaBaka',
    "Manga, manhwa, manhua and light novels from MangaBaka. Reads the volume number from the book's title.",
    '#e30047',
    ['book', 'comic'],
    [],
    'https://mangabaka.org',
  ),
  entry(
    'romanceio',
    'Romance.io',
    'Romance books from Romance.io: community topics, ratings and steam/spice levels.',
    '#dd0489',
    ['book'],
    [],
    'https://www.romance.io',
  ),
  entry(
    'yandexbooks',
    'Yandex Books',
    'Russian books, audiobooks and comics from Yandex Books: descriptions, publishers, series, genres, narrators and running times.',
    '#ff5d5d',
    ['book', 'audiobook', 'comic'],
    ['ru'],
    'https://books.yandex.ru',
  ),
];

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

function parseEntry(raw: unknown): MetadataProviderDirectoryEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const key = typeof value.key === 'string' && EXTERNAL_METADATA_PROVIDER_KEY_PATTERN.test(value.key) ? value.key : null;
  const name = text(value.name, 60);
  const summary = text(value.summary, 300);
  const image = typeof value.image === 'string' && value.image.length <= 200 && IMAGE_PATTERN.test(value.image) ? value.image : null;
  const version = typeof value.version === 'string' && VERSION_PATTERN.test(value.version) ? value.version : null;
  const docsUrl = httpsUrl(value.docsUrl);
  if (!key || !name || !summary || !image || !version || !docsUrl) return null;
  const port =
    value.port === undefined
      ? 8080
      : Number.isInteger(value.port) && (value.port as number) > 0 && (value.port as number) <= 65535
        ? (value.port as number)
        : null;
  if (port === null) return null;
  const mediaTypes = Array.isArray(value.mediaTypes) ? MEDIA_TYPES.filter((type) => (value.mediaTypes as unknown[]).includes(type)) : [];
  const languages = Array.isArray(value.languages)
    ? [...new Set(value.languages.filter((code): code is string => typeof code === 'string' && LANGUAGE_PATTERN.test(code)))].slice(0, MAX_LANGUAGES)
    : [];
  return {
    key,
    name,
    summary,
    image,
    version,
    port,
    docsUrl,
    homepage: httpsUrl(value.homepage),
    color: typeof value.color === 'string' && COLOR_PATTERN.test(value.color) ? value.color.toLowerCase() : null,
    mediaTypes: mediaTypes.length ? mediaTypes : ['book'],
    languages,
  };
}

/**
 * Reads the published `directory.json`. It comes from the network, so every field is checked and an
 * entry that fails is dropped on its own; null means the document as a whole is unusable.
 */
export function parseProviderDirectory(raw: unknown): MetadataProviderDirectoryEntry[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const providers = (raw as Record<string, unknown>).providers;
  if (!Array.isArray(providers)) return null;
  const seen = new Set<string>();
  const entries: MetadataProviderDirectoryEntry[] = [];
  for (const candidate of providers.slice(0, MAX_ENTRIES)) {
    const parsed = parseEntry(candidate);
    if (!parsed || seen.has(parsed.key)) continue;
    seen.add(parsed.key);
    entries.push(parsed);
  }
  return entries.length ? entries : null;
}
