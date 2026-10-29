import type { FolderInspection, FolderSummary, UnclaimedFolder, UnclaimedFolders } from '@bookorbit/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Dirent } from 'fs';
import { readdir, realpath } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { isPrimaryFormat } from '../scanner/lib/classify';
import { isBlockedPath, isInsideOrAt, isListableDirectory, mapLimit, realTarget, SYSTEM_FOLDERS, walkFolder, type WalkOutcome } from './folder-walk';
import { PathPolicyService } from './path-policy.service';
import { PathRepository } from './path.repository';
import { PathService } from './path.service';

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 2_000;
const SUMMARY_MAX_ENTRIES = 10_000;
const SUMMARY_BATCH_BUDGET_MS = 3_000;
const INSPECT_MAX_ENTRIES = 20_000;
const INSPECT_BUDGET_MS = 3_000;
const UNCLAIMED_MAX_ENTRIES = 30_000;
const UNCLAIMED_BUDGET_MS = 4_000;
const UNCLAIMED_MAX_DEPTH = 5;
const UNCLAIMED_RESULTS = 8;

class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    if (this.entries.size > CACHE_MAX) this.entries.delete(this.entries.keys().next().value!);
  }

  clear() {
    this.entries.clear();
  }
}

interface ScanNode {
  own: number;
  formats: Record<string, number>;
  children: string[];
}

function toSummary(path: string, outcome: WalkOutcome): FolderSummary {
  return {
    path,
    state: outcome.state,
    files: outcome.files,
    folderBooks: outcome.folderBooks,
    formats: outcome.formats,
    folders: outcome.folders,
    mergedFolders: outcome.mergedFolders,
    splitAudioFolders: outcome.splitAudioFolders,
    truncated: outcome.truncated,
  };
}

const emptySummary = (path: string, state: FolderSummary['state']): FolderSummary => ({
  path,
  state,
  files: 0,
  folderBooks: 0,
  formats: {},
  folders: 0,
  mergedFolders: 0,
  splitAudioFolders: 0,
  truncated: false,
});

/**
 * What folders hold, for the folder picker. Every walk is bounded by entries and time and says when it
 * stopped, and answers are cached briefly so scrolling back and forth costs nothing.
 */
@Injectable()
export class FolderInsightService {
  private readonly logger = new Logger(FolderInsightService.name);
  private readonly summaries = new TtlCache<FolderSummary>();
  private readonly inspections = new TtlCache<FolderInspection>();
  /** Keyed by the folders libraries read, so a library added or removed elsewhere is seen at once. */
  private unclaimedCache: { claimedKey: string; value: UnclaimedFolders; expires: number } | null = null;
  private unclaimedRun: { claimedKey: string; promise: Promise<UnclaimedFolders> } | null = null;
  /** Bumped by `forget()`, so a walk that started before it does not store its stale answer. */
  private generation = 0;

  constructor(
    private readonly pathPolicy: PathPolicyService,
    private readonly pathService: PathService,
    private readonly pathRepository: PathRepository,
  ) {}

  async summarize(paths: string[], budgetMs = SUMMARY_BATCH_BUDGET_MS): Promise<FolderSummary[]> {
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    let walked = 0;
    const generation = this.generation;
    const results = await mapLimit(paths, 4, async (path): Promise<FolderSummary> => {
      const resolved = await this.resolveOrNull(path);
      // Walked with symlinks followed, so every folder below is checked against the blocked list by its real path.
      const target = resolved && (await realTarget(resolved));
      if (!resolved || !target || isBlockedPath(resolved) || isBlockedPath(target)) return emptySummary(path, 'blocked');
      const cached = this.summaries.get(target);
      if (cached) return { ...cached, path };
      // Folders the batch had no time left for are not reported as empty: the client asks again.
      if (Date.now() > deadline) return emptySummary(path, 'pending');
      walked += 1;
      const outcome = await walkFolder(target, { maxEntries: SUMMARY_MAX_ENTRIES, deadline });
      const summary = toSummary(path, outcome);
      if (this.cacheable(outcome, deadline, generation)) this.summaries.set(target, summary);
      return summary;
    });
    if (walked > 0) {
      this.logger.log(
        `[path.summaries] [end] paths=${paths.length} walked=${walked} truncated=${results.filter((r) => r.truncated).length} durationMs=${Date.now() - startedAt} - folder summaries completed`,
      );
    }
    return results;
  }

  async inspect(path: string): Promise<FolderInspection> {
    const resolved = await this.pathPolicy.resolveBrowsePath(path);
    const target = await realTarget(resolved);
    if (isBlockedPath(resolved) || isBlockedPath(target)) return { ...emptySummary(resolved, 'blocked'), bytes: 0, samples: [] };
    const cached = this.inspections.get(target);
    if (cached) return { ...cached, path: resolved };
    const generation = this.generation;
    const deadline = Date.now() + INSPECT_BUDGET_MS;
    const outcome = await walkFolder(target, { maxEntries: INSPECT_MAX_ENTRIES, deadline, withSizes: true, samples: 2 });
    const inspection: FolderInspection = { ...toSummary(resolved, outcome), bytes: outcome.bytes, samples: outcome.samples };
    if (this.cacheable(outcome, deadline, generation)) this.inspections.set(target, inspection);
    return inspection;
  }

  /** A new folder changes what every folder above it holds, so cached answers are dropped. */
  forget() {
    this.generation += 1;
    this.summaries.clear();
    this.inspections.clear();
    this.unclaimedCache = null;
    this.unclaimedRun = null;
  }

  /**
   * Only a readable folder's answer is kept: a failure may be a passing one (a share reconnecting),
   * and a walk cut short by its time budget is finished by the next request instead.
   */
  private cacheable(outcome: WalkOutcome, deadline: number, generation: number): boolean {
    return outcome.state === 'ok' && generation === this.generation && (!outcome.truncated || Date.now() <= deadline);
  }

  /**
   * Folders holding books that no library reads, biggest first. Stops at the first folder shaped
   * like a library (one folder per book, loose files, or series folders) rather than listing every
   * author folder below it.
   */
  async unclaimed(): Promise<UnclaimedFolders> {
    const claimed = [...new Set((await this.pathRepository.findLibraryFolders()).map((row) => resolve(row.path)))].sort();
    const claimedKey = claimed.join('\0');
    if (this.unclaimedCache?.claimedKey === claimedKey && this.unclaimedCache.expires > Date.now()) return this.unclaimedCache.value;
    // Pickers opened together share one scan rather than walking the mounts once each.
    let run = this.unclaimedRun;
    if (run?.claimedKey !== claimedKey) {
      const started = { claimedKey, promise: this.scanUnclaimed(claimed, claimedKey) };
      this.unclaimedRun = run = started;
      started.promise
        .finally(() => {
          if (this.unclaimedRun === started) this.unclaimedRun = null;
        })
        .catch(() => undefined);
    }
    return run.promise;
  }

  private async scanUnclaimed(claimed: string[], claimedKey: string): Promise<UnclaimedFolders> {
    const startedAt = Date.now();
    const generation = this.generation;
    const places = await this.pathService.getPlaces();
    const rawAppData = this.pathPolicy.getAppDataPath();
    const appDataPath = await this.pathPolicy.getCanonicalAppDataPath();
    // Paths are compared as typed and with symlinks followed: the data folder may be reached through a link.
    const inAppData = (path: string, real: string) =>
      (!!rawAppData && isInsideOrAt(path, rawAppData)) || (!!appDataPath && (isInsideOrAt(path, appDataPath) || isInsideOrAt(real, appDataPath)));
    // Without separate mounts (everything on one filesystem), look around the folders libraries already read.
    const starts = places.mounts.length > 0 ? places.mounts : [...new Set(claimed.map((folder) => dirname(folder)))];
    const reals = new Map(await Promise.all(starts.map(async (root) => [root, await realpath(root).catch(() => root)] as const)));
    const roots = starts.filter((root) => !inAppData(root, reals.get(root)!) && !starts.some((other) => other !== root && isInsideOrAt(root, other)));
    this.logger.log(`[path.unclaimed] [start] roots=${roots.length} claimed=${claimed.length} - unclaimed folder scan started`);

    try {
      const nodes = new Map<string, ScanNode>();
      const deadline = startedAt + UNCLAIMED_BUDGET_MS;
      let entries = 0;
      let truncated = false;
      const queue: Array<{ dir: string; real: string; depth: number }> = roots.map((dir) => ({ dir, real: reals.get(dir)!, depth: 0 }));
      while (queue.length > 0) {
        if (entries >= UNCLAIMED_MAX_ENTRIES || Date.now() > deadline) {
          truncated = true;
          break;
        }
        const { dir, real, depth } = queue.shift()!;
        let dirents: Dirent[];
        try {
          dirents = await readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        entries += dirents.length;
        const node: ScanNode = { own: 0, formats: {}, children: [] };
        for (const entry of dirents) {
          const full = join(dir, entry.name);
          if (isListableDirectory(entry, full)) {
            if (dir === sep && SYSTEM_FOLDERS.has(entry.name)) continue;
            const childReal = join(real, entry.name);
            if (inAppData(full, childReal) || isBlockedPath(childReal)) continue;
            node.children.push(full);
            // Deeper folders are left out of the totals, which are then a lower bound.
            if (depth < UNCLAIMED_MAX_DEPTH) queue.push({ dir: full, real: childReal, depth: depth + 1 });
            else truncated = true;
          } else if (entry.isFile() && isPrimaryFormat(full)) {
            const format = entry.name.split('.').pop()!.toLowerCase();
            node.own += 1;
            node.formats[format] = (node.formats[format] ?? 0) + 1;
          }
        }
        nodes.set(dir, node);
      }

      const totals = new Map<string, { files: number; formats: Record<string, number> }>();
      const total = (dir: string): { files: number; formats: Record<string, number> } => {
        const known = totals.get(dir);
        if (known) return known;
        const node = nodes.get(dir);
        const sum = { files: node?.own ?? 0, formats: { ...(node?.formats ?? {}) } };
        for (const child of node?.children ?? []) {
          const sub = total(child);
          sum.files += sub.files;
          for (const [format, count] of Object.entries(sub.formats)) sum.formats[format] = (sum.formats[format] ?? 0) + count;
        }
        totals.set(dir, sum);
        return sum;
      };

      const found: UnclaimedFolder[] = [];
      const pick = (dir: string): boolean => {
        if (claimed.some((folder) => isInsideOrAt(dir, folder))) return false;
        const sum = total(dir);
        if (sum.files === 0) return false;
        const holdsLibrary = claimed.some((folder) => folder !== dir && isInsideOrAt(folder, dir));
        if (!holdsLibrary && libraryShaped(dir, nodes)) {
          found.push({ path: dir, files: sum.files, formats: sum.formats });
          return true;
        }
        const below = (nodes.get(dir)?.children ?? []).map(pick).some(Boolean);
        if (!below && !holdsLibrary) {
          found.push({ path: dir, files: sum.files, formats: sum.formats });
          return true;
        }
        return below;
      };
      roots.forEach(pick);

      const value: UnclaimedFolders = { folders: found.sort((a, b) => b.files - a.files).slice(0, UNCLAIMED_RESULTS), truncated };
      if (generation === this.generation) this.unclaimedCache = { claimedKey, value, expires: Date.now() + CACHE_TTL_MS };
      this.logger.log(
        `[path.unclaimed] [end] found=${found.length} entries=${entries} truncated=${truncated} durationMs=${Date.now() - startedAt} - unclaimed folder scan completed`,
      );
      return value;
    } catch (error) {
      this.logger.warn(
        `[path.unclaimed] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.constructor.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - unclaimed folder scan failed`,
      );
      throw error;
    }
  }

  private async resolveOrNull(path: string): Promise<string | null> {
    try {
      return await this.pathPolicy.resolveBrowsePath(path);
    } catch {
      return null;
    }
  }
}

/** Loose files, series folders, or one folder per book (directly or under author folders). */
function libraryShaped(dir: string, nodes: Map<string, ScanNode>): boolean {
  const node = nodes.get(dir);
  if (!node) return false;
  const kids = node.children.map((child) => nodes.get(child)).filter((child): child is ScanNode => !!child);
  if (node.own > 0 && node.own >= kids.length) return true;
  if (kids.length === 0) return false;
  const most = (test: (kid: ScanNode) => boolean) => kids.filter(test).length >= Math.max(1, kids.length * 0.6);
  const leafy = (kid: ScanNode) => kid.children.length === 0;
  if (most((kid) => leafy(kid) && kid.own > 0)) return true;
  return most((kid) => {
    const titles = kid.children.map((child) => nodes.get(child)).filter((child): child is ScanNode => !!child);
    return titles.length > 0 && kid.own === 0 && titles.every((title) => title.children.length === 0 && title.own > 0 && title.own <= 2);
  });
}
