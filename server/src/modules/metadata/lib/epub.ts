import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import { ParsedOpf, parseOpf } from './opf-parser';

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
  const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;

  const opfPath = (rootfile as Record<string, unknown> | undefined)?.['@_full-path'];
  if (typeof opfPath !== 'string' || !opfPath) {
    throw new Error('Cannot locate OPF path in container.xml');
  }

  return opfPath;
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
    return parseOpf(opfXml);
  } catch {
    return null;
  }
}
