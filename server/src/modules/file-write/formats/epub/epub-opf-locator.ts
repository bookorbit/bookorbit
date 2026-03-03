import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

const containerParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

export interface OpfLocation {
  opfPath: string;
  opfDir: string;
}

export async function locateOpf(filePath: string): Promise<OpfLocation> {
  const zip = await unzipper.Open.file(filePath);
  const containerFile = zip.files.find((f) => f.path === 'META-INF/container.xml');
  if (!containerFile) throw new Error('Missing META-INF/container.xml');

  const xml = (await containerFile.buffer()).toString('utf-8');
  const parsed = containerParser.parse(xml) as Record<string, unknown>;
  const container = parsed['container'] as Record<string, unknown> | undefined;
  const rootfiles = (container?.['rootfiles'] as Record<string, unknown>)?.['rootfile'];
  const rootfile: unknown = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const opfPath = (rootfile as Record<string, unknown> | undefined)?.['@_full-path'];

  if (typeof opfPath !== 'string' || !opfPath) {
    throw new Error('Cannot locate OPF path in container.xml');
  }

  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  return { opfPath, opfDir };
}
