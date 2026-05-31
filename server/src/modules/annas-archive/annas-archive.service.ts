import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { mkdirSync } from 'fs';
import { unlink, rename } from 'fs/promises';
import { dirname, join } from 'path';
import { load } from 'cheerio';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraryFolders } from '../../db/schema';
import type { StartDownloadDto } from './dto/start-download.dto';
import type { AnnasArchiveSearchResult, AnnasArchiveDownloadJob } from './types';

// Hardcoded fallback domains — refreshed at runtime via Wikipedia
const FALLBACK_DOMAINS = [
  'https://annas-archive.pk',
  'https://annas-archive.gd',
  'https://annas-archive.gl',
  'https://annas-archive.org',
  'https://annas-archive.se',
];

// Patterns that identify actual file download links on book pages
const DOWNLOAD_LINK_PATTERNS = [
  'slow.downloader.pics',
  'fast.downloader.pics',
  'library.lol',
  'libgen.li',
  'libgen.rocks',
  'libgen.fun',
  'ipfs.io/ipfs/',
  'cloudflare-ipfs.com/ipfs/',
  '/download/',
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'nl,en;q=0.9',
};

const WIKIPEDIA_API =
  'https://en.wikipedia.org/w/api.php?action=parse&page=Anna%27s_Archive&prop=wikitext&format=json&formatversion=2';

@Injectable()
export class AnnasArchiveService implements OnModuleInit {
  private readonly logger = new Logger(AnnasArchiveService.name);
  private readonly jobs = new Map<string, AnnasArchiveDownloadJob>();

  /** Live-updated list of reachable domains, sorted by last successful ping */
  private activeDomains: string[] = [...FALLBACK_DOMAINS];

  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  onModuleInit() {
    // Run on startup without blocking the app
    this.refreshDomains().catch((err) => this.logger.warn(`Initial domain refresh failed: ${err}`));
  }

  /** Fetch Wikipedia for current domains + ping each one, refresh activeDomains */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async refreshDomains(): Promise<void> {
    this.logger.log("Refreshing Anna's Archive domains from Wikipedia…");

    const wikiDomains = await this.fetchDomainsFromWikipedia();
    const candidates = [...new Set([...wikiDomains, ...FALLBACK_DOMAINS])];

    const reachable: string[] = [];
    await Promise.all(
      candidates.map(async (domain) => {
        const ok = await this.pingDomain(domain);
        if (ok) reachable.push(domain);
        else this.logger.warn(`Domain unreachable (skipping): ${domain}`);
      }),
    );

    if (reachable.length > 0) {
      this.activeDomains = [...new Set([...reachable])];
      this.logger.log(`Active domains: ${this.activeDomains.join(', ')}`);
    } else {
      this.logger.warn('No domains reachable — keeping previous list');
    }
  }

  async search(query: string, ext?: string, lang?: string): Promise<AnnasArchiveSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (ext) params.set('ext', ext);
    if (lang) params.set('lang', lang);

    this.logger.log(`Anna's Archive search: q="${query}" ext=${ext ?? '-'} lang=${lang ?? '-'}`);

    for (const domain of this.activeDomains) {
      try {
        const response = await fetch(`${domain}/search?${params.toString()}`, {
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) continue;
        const html = await response.text();
        return this.parseSearchResults(html);
      } catch {
        this.logger.warn(`Search failed on domain: ${domain}`);
      }
    }

    throw new BadRequestException("Anna's Archive is unreachable — all known mirrors failed.");
  }

  async getDownloadLinks(md5: string): Promise<string[]> {
    for (const domain of this.activeDomains) {
      try {
        const response = await fetch(`${domain}/md5/${md5}`, {
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 404) throw new NotFoundException(`MD5 ${md5} not found on Anna's Archive`);
        if (!response.ok) continue;
        const html = await response.text();
        return this.parseDownloadLinks(html);
      } catch (err) {
        if (err instanceof NotFoundException) throw err;
        this.logger.warn(`MD5 page failed on domain: ${domain}`);
      }
    }

    throw new BadRequestException("Anna's Archive is unreachable — all known mirrors failed.");
  }

  async startDownload(dto: StartDownloadDto): Promise<AnnasArchiveDownloadJob> {
    const destPath = await this.resolveDestPath(dto);
    const jobId = `${dto.md5}-${Date.now()}`;
    const job: AnnasArchiveDownloadJob = {
      id: jobId,
      md5: dto.md5,
      filename: dto.filename,
      destPath,
      status: 'pending',
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);

    this.runDownload(job).catch((err) => {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} failed: ${job.error}`);
    });

    return job;
  }

  getDownload(jobId: string): AnnasArchiveDownloadJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundException(`Download job not found: ${jobId}`);
    return job;
  }

  listDownloads(): AnnasArchiveDownloadJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  getActiveDomains(): string[] {
    return [...this.activeDomains];
  }

  private async fetchDomainsFromWikipedia(): Promise<string[]> {
    try {
      const response = await fetch(WIKIPEDIA_API, {
        headers: { 'User-Agent': FETCH_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as { parse?: { wikitext?: string } };
      const wikitext = data.parse?.wikitext ?? '';

      const matches = wikitext.matchAll(/https?:\/\/(annas-archive\.[a-z]{2,})/gi);
      const domains: string[] = [];
      for (const m of matches) {
        const domain = `https://${m[1]}`;
        if (!domains.includes(domain)) domains.push(domain);
      }

      this.logger.log(`Wikipedia domains found: ${domains.join(', ') || '(none)'}`);
      return domains;
    } catch (err) {
      this.logger.warn(`Wikipedia fetch failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  private async pingDomain(domain: string): Promise<boolean> {
    try {
      const response = await fetch(`${domain}/`, {
        method: 'HEAD',
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(5_000),
      });
      return response.status < 500;
    } catch {
      return false;
    }
  }

  private async resolveDestPath(dto: StartDownloadDto): Promise<string> {
    let folderPath: string;

    if (dto.folderId) {
      const [folder] = await this.db.select().from(libraryFolders).where(eq(libraryFolders.id, dto.folderId)).limit(1);
      if (!folder) throw new NotFoundException(`Library folder ${dto.folderId} not found`);
      folderPath = folder.path;
    } else {
      const folders = await this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, dto.libraryId));
      if (folders.length === 0) throw new NotFoundException(`No folders found in library ${dto.libraryId}`);
      folderPath = folders[0].path;
    }

    const safeFilename = dto.filename.replace(/[/\\?%*:|"<>]/g, '-');
    return join(folderPath, safeFilename);
  }

  private async runDownload(job: AnnasArchiveDownloadJob): Promise<void> {
    job.status = 'fetching_links';
    const links = await this.getDownloadLinks(job.md5);

    if (links.length === 0) {
      throw new Error('No download links found for this book');
    }

    job.status = 'downloading';
    mkdirSync(dirname(job.destPath), { recursive: true });

    for (const link of links) {
      try {
        await this.downloadFromLink(link, job);
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        this.logger.log(`Job ${job.id} completed → ${job.destPath}`);
        return;
      } catch (err) {
        this.logger.warn(`Link failed (${link}): ${err instanceof Error ? err.message : err}`);
      }
    }

    throw new Error('All download links exhausted without success');
  }

  private async downloadFromLink(url: string, job: AnnasArchiveDownloadJob): Promise<void> {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error('Empty response body');

    job.totalBytes = Number(response.headers.get('content-length') ?? 0) || undefined;
    job.downloadedBytes = 0;

    const tempPath = `${job.destPath}.tmp`;
    const { createWriteStream } = await import('fs');
    const writer = createWriteStream(tempPath);

    try {
      const reader = response.body.getReader();
      await new Promise<void>((resolve, reject) => {
        const pump = async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              job.downloadedBytes = (job.downloadedBytes ?? 0) + value.length;
              if (!writer.write(value)) await new Promise<void>((r) => writer.once('drain', r));
            }
            writer.end();
            writer.once('finish', resolve);
            writer.once('error', reject);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        };
        void pump();
      });
    } catch (err) {
      writer.destroy();
      await unlink(tempPath).catch(() => {});
      throw err;
    }

    await rename(tempPath, job.destPath);
  }

  private parseSearchResults(html: string): AnnasArchiveSearchResult[] {
    const $ = load(html);
    const results: AnnasArchiveSearchResult[] = [];
    const seen = new Set<string>();

    $('a[href^="/md5/"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const md5 = href.replace('/md5/', '').split('?')[0].split('#')[0].trim();
      if (!md5 || !/^[a-f0-9]{32}$/.test(md5)) return;
      if (seen.has(md5)) return;
      seen.add(md5);

      const blockText = $(el).text();
      const lines = blockText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const title = lines[0] ?? '';
      const author = lines[1] ?? undefined;

      const formatMatch = blockText.match(/\b(epub|pdf|mobi|azw3?|cbz|cbr|fb2|djvu)\b/i);
      const sizeMatch = blockText.match(/(\d+(?:[,.]\d+)?)\s*(KB|MB|GB)/i);
      const langMatch = blockText.match(/\b(en|nl|de|fr|es|pt|it|ru|zh|ja|ko)\b/);

      if (!title || title.length < 2) return;

      results.push({
        md5,
        title: title.slice(0, 300),
        author: author && author !== title ? author.slice(0, 200) : undefined,
        format: formatMatch?.[1].toLowerCase(),
        filesize: sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined,
        language: langMatch?.[1],
        url: `${this.activeDomains[0] ?? FALLBACK_DOMAINS[0]}/md5/${md5}`,
      });
    });

    return results;
  }

  private parseDownloadLinks(html: string): string[] {
    const $ = load(html);
    const links: string[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href.startsWith('http')) return;

      const isDownload =
        DOWNLOAD_LINK_PATTERNS.some((p) => href.includes(p)) ||
        /\.(epub|pdf|mobi|azw3?|cbz|cbr|fb2)(\?|$)/i.test(href);

      if (isDownload && !seen.has(href)) {
        seen.add(href);
        links.push(href);
      }
    });

    return links;
  }
}
