import { Logger } from '@nestjs/common';
import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import { scanEpubSpineForIsbn } from './epub-isbn-scan';
import { ParsedOpf, parseOpf } from './opf-parser';

const logger = new Logger('EpubMetadata');

const containerParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

async function readFileFromZip(zip: unzipper.CentralDirectory, filePath: string): Promise<string> {
  const file = zip.files.find((f) => f.path === filePath || f.path === filePath.replace(/^\//, ''));
  if (!file) throw new Error(`File not found in EPUB: ${filePath}`);
  const buf = await file.buffer();
  return buf.toString('utf-8');
}

async function findOpfPath(zip: unzipper.CentralDirectory): Promise<string> {
  const containerXml = await readFileFromZip(zip, 'META-INF/container.xml');
  const parsed = containerParser.parse(containerXml) as Record<string, unknown>;

  const container = parsed['container'] as Record<string, unknown>;
  const rootfiles = (container?.['rootfiles'] as Record<string, unknown>)?.['rootfile'];
  const rootfile: unknown = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;

  const opfPath = (rootfile as Record<string, unknown> | undefined)?.['@_full-path'];
  if (typeof opfPath !== 'string' || !opfPath) {
    throw new Error('Cannot locate OPF path in container.xml');
  }

  return opfPath;
}

/**
 * True when an OPF declares the EPUB fixed-layout. Comics and manga converted by tools
 * such as Kindle Comic Converter set this; readers must render them without reflow margins.
 */
export function isPrePaginated(opf: Pick<ParsedOpf, 'renditionLayout'>): boolean {
  return opf.renditionLayout?.trim().toLowerCase() === 'pre-paginated';
}

/**
 * Read only the fixed-layout flag from an EPUB. Returns null when the file cannot be opened
 * or parsed, which callers must keep distinct from a parsed `false` so a transient read
 * failure is never persisted as "this book reflows".
 */
export async function extractEpubFixedLayout(absolutePath: string): Promise<boolean | null> {
  try {
    const zip = await unzipper.Open.file(absolutePath);
    const opfPath = await findOpfPath(zip);
    return isPrePaginated(parseOpf(await readFileFromZip(zip, opfPath)));
  } catch {
    return null;
  }
}

/**
 * Open an EPUB file and extract metadata from its OPF.
 * Returns null if the file is not a valid EPUB or parsing fails.
 */
export async function extractEpubMetadata(absolutePath: string): Promise<ParsedOpf | null> {
  try {
    const zip = await unzipper.Open.file(absolutePath);
    const opfPath = await findOpfPath(zip);
    const opfXml = await readFileFromZip(zip, opfPath);
    const opf = parseOpf(opfXml);

    if (opf.isbn10 == null && opf.isbn13 == null) {
      const found = await scanEpubSpineForIsbn(zip, opfXml, opfPath);
      if (found.isbn10 || found.isbn13) {
        opf.isbn10 = found.isbn10;
        opf.isbn13 = found.isbn13;
        logger.debug(`[epub.isbn_fallback] isbn13=${found.isbn13 ?? ''} isbn10=${found.isbn10 ?? ''} - recovered isbn from content`);
      }
    }

    return opf;
  } catch {
    return null;
  }
}
