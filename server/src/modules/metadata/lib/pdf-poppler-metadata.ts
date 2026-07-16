import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const PDFINFO_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export interface PopplerPdfMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  pageCount: number | null;
  xmpXml: string | null;
}

function clean(value: string | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

export function parsePdfInfoOutput(output: string): Omit<PopplerPdfMetadata, 'xmpXml'> {
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    fields.set(match[1].trim().toLowerCase(), match[2].trim());
  }

  const pageCountRaw = clean(fields.get('pages'));
  const pageCount = pageCountRaw ? Number.parseInt(pageCountRaw, 10) : Number.NaN;

  return {
    title: clean(fields.get('title')),
    author: clean(fields.get('author')),
    subject: clean(fields.get('subject')),
    keywords: clean(fields.get('keywords')),
    creator: clean(fields.get('creator')),
    producer: clean(fields.get('producer')),
    pageCount: Number.isFinite(pageCount) ? pageCount : null,
  };
}

function cleanXmp(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.includes('<rdf:RDF') || trimmed.includes('<x:xmpmeta') ? trimmed : null;
}

async function runPdfInfo(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('pdfinfo', args, { maxBuffer: PDFINFO_MAX_BUFFER_BYTES });
  return stdout;
}

export async function extractPopplerPdfMetadata(absolutePath: string): Promise<PopplerPdfMetadata | null> {
  const [infoResult, xmpResult] = await Promise.allSettled([runPdfInfo([absolutePath]), runPdfInfo(['-meta', absolutePath])]);

  if (infoResult.status === 'rejected' && xmpResult.status === 'rejected') {
    throw infoResult.reason instanceof Error ? infoResult.reason : new Error(String(infoResult.reason));
  }

  const info = infoResult.status === 'fulfilled' ? parsePdfInfoOutput(infoResult.value) : parsePdfInfoOutput('');
  const xmpXml = xmpResult.status === 'fulfilled' ? cleanXmp(xmpResult.value) : null;

  return {
    ...info,
    xmpXml,
  };
}
