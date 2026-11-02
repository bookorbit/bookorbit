import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_LOCALE, type Locale } from '@bookorbit/types';

/**
 * Text the server writes itself and sends to clients that show it as is: achievement names and
 * descriptions, category labels, the monthly challenge. Clients ask for a language with
 * `Accept-Language`; the web sends the one picked in its settings and the iOS app the one its own
 * interface resolved to.
 *
 * The translations live in the web's catalogs, under `serverText`, so they reach Crowdin, its
 * validation and its translators through the one pipeline the web already has.
 *
 * English is never looked up. It comes from the same place it always did (the seeded rows, the
 * constants), so a request without the header, or from a client that predates it, gets exactly the
 * bytes it got before. `serverText` in `en.json` mirrors that text only so Crowdin has a source to
 * translate, and a test keeps the two equal. A translation that is missing or empty falls back to
 * English.
 */
type Catalog = { [key: string]: string | Catalog };

const NAMESPACE = 'serverText';

const catalogs = new Map<Locale, Catalog>();

/**
 * Where the web's catalogs are. In the repository they sit beside the server, whether this runs
 * from `src` or `dist`; the image copies them next to `dist`. Found on first use rather than at
 * import, so a module that mocks `fs` can still import anything that imports this.
 */
function localesDirectory(): string | undefined {
  const candidates = [join(__dirname, '..', '..', '..', '..', 'client', 'src', 'locales'), join(__dirname, '..', '..', '..', 'locales')];
  return candidates.find((directory) => existsSync(join(directory, `${DEFAULT_LOCALE}.json`)));
}

function catalog(locale: Locale): Catalog {
  const cached = catalogs.get(locale);
  if (cached) return cached;
  const directory = localesDirectory();
  const file = directory ? join(directory, `${locale}.json`) : null;
  let loaded: Catalog = {};
  if (file && existsSync(file)) {
    try {
      const messages = JSON.parse(readFileSync(file, 'utf8')) as Catalog;
      const namespace = messages[NAMESPACE];
      loaded = namespace && typeof namespace === 'object' ? namespace : {};
    } catch {
      loaded = {};
    }
  }
  catalogs.set(locale, loaded);
  return loaded;
}

function lookup(tree: Catalog, key: string): string | null {
  let node: string | Catalog | undefined = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return null;
    node = node[part];
  }
  return typeof node === 'string' && node.trim().length > 0 ? node : null;
}

/** `english` in English or when `locale` has no translation for `key`, otherwise the translation. */
export function serverText(locale: Locale, key: string, english: string): string {
  if (locale === DEFAULT_LOCALE) return english;
  return lookup(catalog(locale), key) ?? english;
}

/** The English source of `serverText`, for the test that keeps it equal to the text it mirrors. */
export function englishCatalog(): Catalog {
  return catalog(DEFAULT_LOCALE);
}

/** Stands in a `serverText` tree for `locale` until `resetServerTextCache`, for tests. */
export function primeServerTextCatalog(locale: Locale, tree: Catalog): void {
  catalogs.set(locale, tree);
}

/** Forgets loaded and primed catalogs. */
export function resetServerTextCache(): void {
  catalogs.clear();
}
