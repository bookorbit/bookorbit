import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

export { createEpubFixture } from '../metadata-write/metadata-write-fixture-builder';

export interface AuthorizationMatrixFixtureRoot {
  rootPath: string;
  booksPath: string;
  bookDockPath: string;
  cleanup: () => Promise<void>;
}

export interface Fb2FixtureInput {
  title?: string;
  authors?: string[];
  language?: string;
  genre?: string;
  description?: string;
  year?: number;
}

function assertRelativePath(path: string): void {
  if (path.startsWith('/')) {
    throw new Error(`Fixture paths must be relative. Received "${path}"`);
  }
}

export async function createAuthorizationFixtureRoot(prefix = 'authorization-matrix-e2e-'): Promise<AuthorizationMatrixFixtureRoot> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));
  const booksPath = join(rootPath, 'books');
  const bookDockPath = join(booksPath, 'book-dock');
  await mkdir(bookDockPath, { recursive: true });

  return {
    rootPath,
    booksPath,
    bookDockPath,
    cleanup: async () => {
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

export async function writeFixtureFile(rootPath: string, relativePath: string, content: string | Buffer): Promise<string> {
  assertRelativePath(relativePath);

  const absolutePath = join(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  return absolutePath;
}

export function buildFb2Fixture(input: Fb2FixtureInput = {}): string {
  const title = input.title ?? 'Authorization Matrix Fixture Title';
  const authors = input.authors ?? ['Authorization Matrix Fixture Author'];
  const language = input.language ?? 'en';
  const genre = input.genre ?? 'fiction';
  const description = input.description ?? 'Fixture description';
  const year = input.year ?? 2024;

  const authorXml = authors
    .map((name) => {
      const [firstName = 'Unknown', ...rest] = name.trim().split(/\s+/);
      const lastName = rest.length > 0 ? rest.join(' ') : 'Author';
      return `<author><first-name>${escapeXml(firstName)}</first-name><last-name>${escapeXml(lastName)}</last-name></author>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>${escapeXml(genre)}</genre>
      ${authorXml}
      <book-title>${escapeXml(title)}</book-title>
      <annotation><p>${escapeXml(description)}</p></annotation>
      <date>${year}</date>
      <lang>${escapeXml(language)}</lang>
    </title-info>
    <publish-info>
      <year>${year}</year>
    </publish-info>
  </description>
  <body>
    <section><p>fixture content</p></section>
  </body>
</FictionBook>
`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
