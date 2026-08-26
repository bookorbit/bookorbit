import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AUTO_SEARCH_BACKOFF_WEEK_MS,
  compareByTier,
  findGrabRefusal,
  isGrabbableBookRequestStatus,
  MAX_AUTO_SEARCH_BACKOFF_FACTOR,
  NotificationType,
  releaseProfileIsActive,
} from '@bookorbit/types';
import type {
  BookRequestAutomationSettings,
  BookRequestFailureMeta,
  BookRequestHandbackCode,
  BookRequestStatus,
  GrabFailureCode,
  GrabRefusal,
  IndexerSearchStatus,
  ReleaseCandidateItem,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { BookRequestRow } from '../../../db/schema';
import { BOOK_REQUEST_DOWNLOAD_FAILED, BookRequestEventsService } from '../book-request-events.service';
import { BookRequestNotifier } from '../book-request-notifier.service';
import { BookRequestRepository } from '../book-request.repository';
import { bookRequestSearchIsbns, type IndexerSearchMode, IndexerSearchService } from '../indexers/indexer-search.service';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { grabFailureCode, RequestAlreadyClaimedException, RequestFulfillmentService } from './request-fulfillment.service';
import { RequestAutomationSearchDelay } from './request-automation-search-delay.service';
import { RequestAutomationSettingsService } from './request-automation-settings.service';

/**
 * What set an attempt off, which decides where a request lands when nothing is grabbable and
 * whether anybody is told about it.
 *
 * `approval` and `auto_approval` behave identically until automation gives up. They differ in who
 * is watching: an approver who just approved is looking at the queue, while an auto-approved
 * request was never in anybody's queue and its requester cannot open the picker, so a hand-back
 * nobody announces is a request that waits forever.
 */
type AutomationTrigger = 'approval' | 'auto_approval' | 'retry' | 'periodic';

/**
 * One sweep's worth of requests to look for again. A backlog is worked off over several ticks
 * rather than in one pass that would search every enabled tracker fifty times in a row.
 */
const RESEARCH_SWEEP_LIMIT = 25;

/**
 * The one status an automation pass may write a terminal result from: the one it claimed itself.
 *
 * `searching` is deliberately grabbable, so an approver can pick a release mid-pass. Everything
 * the pass tries afterwards is refused, and without this its "no release could be started" would
 * land on the healthy download they just started.
 */
const CLAIMED_BY_THIS_PASS: readonly BookRequestStatus[] = ['searching'];

/** The prose that accompanies each code. English on purpose; the code is what the UI translates. */
interface Handback {
  code: BookRequestHandbackCode;
  reason: string;
  meta?: BookRequestFailureMeta;
}

/** One release that was handed over and refused, kept for the reason the request ends up carrying. */
interface AttemptFailure {
  indexerName: string;
  message: string;
}

/**
 * Grabs without an approver, when the top release is good enough to be worth grabbing unattended.
 *
 * Off by default. Book matching is hard - editions, abridgements, translations, three different
 * books called It - so this is a score floor an operator raises or lowers deliberately, and a
 * request that clears nothing simply waits for a human with the reason written on it.
 */
@Injectable()
export class RequestAutomationService implements OnModuleInit {
  private readonly logger = new Logger(RequestAutomationService.name);
  /** A sweep can outlast an hour on a slow tracker, and two of them would search everything twice. */
  private sweeping = false;

  constructor(
    private readonly settings: RequestAutomationSettingsService,
    private readonly requests: BookRequestRepository,
    private readonly downloads: BookRequestDownloadRepository,
    private readonly releases: IndexerSearchService,
    private readonly fulfillment: RequestFulfillmentService,
    private readonly events: BookRequestEventsService,
    private readonly notifier: BookRequestNotifier,
    private readonly searchDelay: RequestAutomationSearchDelay,
  ) {}

  onModuleInit(): void {
    this.events.on(BOOK_REQUEST_DOWNLOAD_FAILED, (downloadId: number) => {
      void this.handleFailure(downloadId).catch((error: unknown) => {
        const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
        this.logger.error(`[book_request.auto_retry] [fail] downloadId=${downloadId} error="${message}" - retry handler failed`);
      });
    });
  }

  /**
   * Called after an approval, and after an auto-approved user submits. Deliberately fire and
   * forget: searching every enabled indexer can take twenty seconds, and an approver should not
   * hold an HTTP request open for it. The request moves to `searching` so the UI says what is
   * happening, and the gateway pushes it on from there.
   */
  considerRequest(requestId: number, trigger: Exclude<AutomationTrigger, 'retry'> = 'approval'): void {
    void this.runAttempt(requestId, trigger).catch((error: unknown) => {
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.error(`[book_request.auto_grab] [fail] requestId=${requestId} error="${message}" - auto-grab attempt failed`);
    });
  }

  /**
   * The wanted list: approved requests nothing has found a release for yet, looked for again.
   *
   * Everywhere else in this service an attempt is set off by something a person did. Without this
   * one, a request declined for want of a good enough release - or for a book whose first release
   * is posted next month - sits at `approved` forever, and the only thing that would ever find it
   * is somebody reopening the picker by hand. That is the one gap the pipeline has no other answer
   * to, and it is invisible: the request looks like work somebody has already taken.
   *
   * Hourly rather than on the operator's interval, because the interval is per request and each
   * row carries its own clock. A tick with nothing due costs one bounded query.
   *
   * Sequential, like `runBulk` and for the same reason: twenty-five simultaneous searches against
   * one private tracker is what a rate limit looks like from the other side. `runAttempt` claims
   * conditionally and is safe to re-enter, so a request an approver acts on mid-sweep is left
   * alone by the pass that reaches it.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepUnfulfilled(): Promise<void> {
    if (this.sweeping) return;
    const startedAt = Date.now();
    this.sweeping = true;
    try {
      await this.researchDueRequests();
    } catch (error: unknown) {
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[book_request.auto_search] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - the periodic re-search sweep failed`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  private async researchDueRequests(): Promise<void> {
    const settings = await this.settings.get();
    // Both, because an unattended search has nothing to do with what it finds while auto-grab is
    // off: every request it touched would be handed straight back, having cost a real search.
    if (!settings.autoSearchEnabled || !settings.autoGrabEnabled) return;

    const due = await this.requests.findDueForResearch(
      settings.autoSearchIntervalHours,
      settings.autoSearchMaxAgeDays,
      MAX_AUTO_SEARCH_BACKOFF_FACTOR,
      AUTO_SEARCH_BACKOFF_WEEK_MS,
      RESEARCH_SWEEP_LIMIT,
    );
    if (due.length === 0) return;

    const startedAt = Date.now();
    this.logger.log(
      `[book_request.auto_search] [start] due=${due.length} intervalHours=${settings.autoSearchIntervalHours} maxAgeDays=${settings.autoSearchMaxAgeDays} - looking again for requests nothing has found`,
    );

    let searched = 0;
    for (const [index, row] of due.entries()) {
      if (index > 0) await this.searchDelay.wait();
      // Each pass reloads the row and re-runs every guard, so one that throws must not take the
      // rest of the sweep with it; the next tick will reach the row again either way.
      const requestStartedAt = Date.now();
      try {
        await this.runAttempt(row.id, 'periodic', settings);
        searched++;
      } catch (error: unknown) {
        const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
        const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
        this.logger.warn(
          `[book_request.auto_search] [fail] requestId=${row.id} durationMs=${Date.now() - requestStartedAt} errorClass=${errorClass} error="${message}" - re-searching this request failed`,
        );
      }
    }

    this.logger.log(
      `[book_request.auto_search] [end] due=${due.length} searched=${searched} limit=${RESEARCH_SWEEP_LIMIT} durationMs=${Date.now() - startedAt} - periodic re-search finished`,
    );
  }

  private async handleFailure(downloadId: number): Promise<void> {
    const settings = await this.settings.get();
    if (!settings.autoRetryEnabled) return;

    const download = await this.downloads.findById(downloadId);
    // A release an approver picked by hand failed for a reason they chose. Replacing it with the
    // runner-up behind their back is not automation, it is overruling them.
    if (!download?.automated) return;

    await this.runAttempt(download.requestId, 'retry', settings);
  }

  private async runAttempt(requestId: number, trigger: AutomationTrigger, preloaded?: BookRequestAutomationSettings): Promise<void> {
    const settings = preloaded ?? (await this.settings.get());

    const joined = await this.requests.findById(requestId);
    if (!joined) return;
    const request = joined.request;
    if (!isGrabbableBookRequestStatus(request.status as BookRequestStatus)) return;

    // What the guards below are reasoning about, and therefore the only status any of them may
    // write a decision from. Every one of them runs before this pass has claimed anything, so a
    // request that moves on underneath them belongs to whoever moved it.
    const observed: readonly BookRequestStatus[] = [request.status as BookRequestStatus];

    // After the guards, not before them: this writes a status, and `considerRequest` is fire and
    // forget, so a request cancelled in the meantime would otherwise be resurrected to `approved`.
    if (!settings.autoGrabEnabled) {
      // An approver who just approved is about to open the picker, and stamping "automatic
      // grabbing is off" on every approval an operator never asked to automate is noise. An
      // auto-approved request has nobody behind it, so the same silence strands it.
      if (trigger === 'auto_approval') {
        await this.decline(requestId, trigger, observed, {
          code: 'AUTOMATION_DISABLED',
          reason: 'Automatic grabbing is off, so this one needs a release picked by hand',
        });
      }
      return;
    }

    // Grab refuses a request with nowhere to file the book, so say so here rather than letting a
    // whole download run and stop at the last step.
    if (request.targetLibraryId === null) {
      await this.decline(requestId, trigger, observed, {
        code: 'NO_DESTINATION',
        reason: 'Automatic grab needs a destination library on the request',
      });
      return;
    }

    const spent = await this.downloads.countAutomatedForRequest(requestId);
    if (spent >= settings.maxAutoGrabAttempts) {
      this.logger.log(
        `[book_request.auto_grab] [end] requestId=${requestId} trigger=${trigger} attempts=${spent} limit=${settings.maxAutoGrabAttempts} - attempt limit reached, leaving it for an approver`,
      );
      // A spent budget leaves the request exactly as the failure left it. "Gave up after three
      // attempts" would overwrite what actually went wrong, which is the part an approver needs.
      // Only said to whoever just approved, too: a periodic pass restating it every night would
      // rewrite the same reason and broadcast a change nobody made.
      if (trigger === 'approval' || trigger === 'auto_approval') {
        await this.decline(requestId, trigger, observed, {
          code: 'ATTEMPT_LIMIT',
          reason: `Automatic fulfilment gave up after ${spent} attempts`,
          meta: { attempts: spent },
        });
      }
      return;
    }

    // The claim on the work, and the last check before anything is asked of a tracker. A plain
    // compare-and-set against the status the guards above ran on: this is fire and forget, so a
    // request cancelled in the meantime would otherwise cost a search against every enabled
    // indexer, and one somebody grabbed a release for by hand would have `searching` stamped over
    // a live download.
    if (!(await this.fulfillment.setRequestStatus(requestId, 'searching', null, null, [request.status as BookRequestStatus]))) {
      this.logger.log(
        `[book_request.auto_grab] [end] requestId=${requestId} trigger=${trigger} from=${request.status} - the request moved on before the search started, so nothing was searched`,
      );
      return;
    }

    const pick = await this.pickReleases(request, settings).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[book_request.auto_grab] [fail] requestId=${requestId} trigger=${trigger} error="${sanitizeLogValue(message)}" - release search failed`,
      );
      return new Error(message);
    });

    // A search that threw must not leave the request sitting at "searching" with nobody told.
    if (pick instanceof Error) {
      await this.decline(requestId, trigger, CLAIMED_BY_THIS_PASS, {
        code: 'SEARCH_FAILED',
        reason: `Could not search for a release: ${pick.message}`,
        meta: { detail: pick.message },
      });
      return;
    }

    if (pick.candidates.length === 0) {
      // "Nothing scored well enough" and "everything that did has already been tried" are
      // different problems, and only one of them is fixed by adding an indexer. A search that
      // never ran is a third: reporting a score floor for it points the operator at a number that
      // had no bearing on anything, and reads as a judgement about a book nothing ever looked for.
      const scoredNothing: Handback = pick.profileExcludedAll
        ? {
            code: 'PROFILE_EXCLUDED_ALL',
            reason: 'No release matched the profile for this medium, so this one needs a release picked by hand',
          }
        : pick.allTried
          ? {
              code: 'ALL_TRIED',
              reason: 'Every release good enough to grab has already been tried for this request, so it needs a release picked by hand',
            }
          : {
              code: 'BELOW_SCORE_FLOOR',
              reason: `No release scored ${settings.autoGrabMinScore} or better, so this one needs a release picked by hand`,
              meta: { floor: settings.autoGrabMinScore },
            };
      const handback = this.nothingSearched(pick) ?? scoredNothing;
      this.logger.log(
        `[book_request.auto_grab] [end] requestId=${requestId} trigger=${trigger} attempt=${spent + 1} picked=none code=${handback.code} enabled=${pick.enabledIndexerCount} allTried=${pick.allTried} floor=${settings.autoGrabMinScore} - nothing left to grab`,
      );
      await this.decline(requestId, trigger, CLAIMED_BY_THIS_PASS, handback);
      return;
    }

    await this.grabFirstThatStarts(requestId, trigger, settings, pick, spent);
  }

  /**
   * Works down the ranked list until something is actually downloading.
   *
   * A refusal is an answer about one thing, and the failover is built on which thing: a tracker
   * that will not serve a VIP-only release still serves its ordinary ones, a tracker that rejects
   * the account serves nothing, and a download client that is down refuses every torrent while
   * saying nothing about a source BookOrbit fetches from itself. Skipping what the refusal already
   * ruled out is what stops the budget being spent three times on the same "no".
   */
  private async grabFirstThatStarts(
    requestId: number,
    trigger: AutomationTrigger,
    settings: BookRequestAutomationSettings,
    pick: ReleasePicks,
    alreadySpent: number,
  ): Promise<void> {
    const blocked = new BlockedSources(pick.indexers);
    const failures: AttemptFailure[] = [];
    const limit = settings.maxAutoGrabAttempts;
    let spent = alreadySpent;
    let skipped = 0;

    for (const release of pick.candidates) {
      if (spent >= limit) break;
      if (blocked.blocks(release)) {
        skipped++;
        continue;
      }

      spent++;
      try {
        await this.fulfillment.grab(requestId, { indexerId: release.indexerId, releaseGuid: release.guid }, null);
        this.logger.log(
          `[book_request.auto_grab] [end] requestId=${requestId} trigger=${trigger} attempt=${spent}/${limit} indexerId=${release.indexerId} indexer="${sanitizeLogValue(release.indexerName)}" score=${release.score} skipped=${skipped} refused=${failures.length} floor=${settings.autoGrabMinScore} - grabbed unattended`,
        );
        return;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const code = grabFailureCode(error);
        failures.push({ indexerName: release.indexerName, message });

        // An untagged failure is one nobody classified, which means nobody can say what a second
        // attempt would do differently. Stopping is the honest answer; so is stopping when the
        // operator asked for a single attempt, and so is somebody else having taken the request:
        // every remaining candidate would be refused for that same reason.
        const claimed = error instanceof RequestAlreadyClaimedException;
        const halt = claimed || code === null || !settings.autoRetryEnabled;
        if (code !== null && !claimed) blocked.record(release, code);

        this.logger.warn(
          `[book_request.auto_grab] [fail] requestId=${requestId} trigger=${trigger} attempt=${spent}/${limit} indexerId=${release.indexerId} indexer="${sanitizeLogValue(release.indexerName)}" release="${sanitizeLogValue(release.title)}" score=${release.score} code=${code ?? 'unclassified'} error="${sanitizeLogValue(message)}" - ${nextStepDescription(code, halt)}`,
        );
        if (halt) break;
      }
    }

    this.logger.log(
      `[book_request.auto_grab] [end] requestId=${requestId} trigger=${trigger} attempts=${spent}/${limit} refused=${failures.length} skipped=${skipped} candidates=${pick.candidates.length} - no release could be started`,
    );

    // Something was handed over and refused, so the request failed whatever set it off: `failed`
    // is the status whose picker leads with the reason and offers another release. Conditional on
    // this pass's own claim, so an approver who grabbed a release mid-pass keeps their download
    // rather than watching it be stamped failed.
    if (failures.length > 0) {
      if (!(await this.fulfillment.setRequestStatus(requestId, 'failed', summarizeFailures(failures), null, CLAIMED_BY_THIS_PASS))) {
        this.logger.log(
          `[book_request.auto_grab] [end] requestId=${requestId} trigger=${trigger} - the request was taken over while the pass was running, so its failures were not written`,
        );
        return;
      }
      // The same reason `decline` announces: an auto-approved request has nobody behind it. Nobody
      // was told it existed and its requester cannot open the picker, so a `failed` row nothing
      // announces is a dead end - which, with the download client down, is where every
      // auto-approved request quietly ends up.
      await this.announceUnattended(
        requestId,
        trigger,
        'GRABS_REFUSED',
        (title) => `"${title}" was approved without a decision and every release BookOrbit tried was refused`,
      );
      return;
    }
    await this.decline(requestId, trigger, CLAIMED_BY_THIS_PASS, {
      code: 'ALL_BLOCKED',
      reason: 'Every release good enough to grab was ruled out by an earlier failure, so this one needs a release picked by hand',
    });
  }

  /**
   * Why no source was asked anything, where that is what happened. Null when a search really ran
   * and the empty list is a fact about the book rather than about the instance.
   */
  private nothingSearched(pick: ReleasePicks): Handback | null {
    if (pick.enabledIndexerCount === 0) {
      return pick.configuredIndexerCount === 0
        ? { code: 'NO_SOURCES_CONFIGURED', reason: 'No search source is configured, so nothing was searched' }
        : { code: 'NO_SOURCES_ENABLED', reason: 'Every search source is switched off, so nothing was searched' };
    }
    if (pick.indexers.length === 0 && pick.uncoveredIndexerCount > 0) {
      return { code: 'MEDIUM_UNCOVERED', reason: 'No enabled search source carries this kind of book, so nothing was searched' };
    }
    return null;
  }

  /**
   * Searches the recommended ISBN, one alternate ISBN, then title and author, stopping as soon as
   * an untried release clears the profile and score floor. Indexers without ISBN search support
   * participate in the first pass by title and author and are not called again.
   *
   * `allTried` separates the two ways of coming back empty, because they read very differently to
   * whoever picks up the request: nothing was good enough, or nothing new is left.
   */
  private async pickReleases(request: BookRequestRow, settings: BookRequestAutomationSettings): Promise<ReleasePicks> {
    const profiled = releaseProfileIsActive(settings.profiles[request.mediaKind]);
    const tried = await this.downloads.findTriedReleaseKeys(request.id);
    const releases = new Map<string, ReleaseCandidateItem>();
    const indexers = new Map<number, IndexerSearchStatus>();
    const isbns = bookRequestSearchIsbns(request).slice(0, 2);
    const variants: AutomationSearchVariant[] =
      isbns.length === 0
        ? [{ indexerMode: 'all' }]
        : [
            { indexerMode: 'all' },
            ...isbns.slice(1).map((isbn) => ({ indexerMode: 'isbn-capable' as const, isbn })),
            { indexerMode: 'isbn-capable', isbn: null },
          ];

    let picks: ReleasePicks = {
      candidates: [],
      indexers: [],
      allTried: false,
      profileExcludedAll: false,
      enabledIndexerCount: 0,
      configuredIndexerCount: 0,
      uncoveredIndexerCount: 0,
    };

    for (const [index, variant] of variants.entries()) {
      if (index > 0) await this.searchDelay.wait();

      const result = await this.releases.search(request, {
        indexerMode: variant.indexerMode,
        ...(variant.isbn !== undefined ? { overrides: { isbn: variant.isbn } } : {}),
      });
      for (const status of result.indexers) indexers.set(status.indexerId, status);
      for (const release of result.releases) {
        const key = `${release.indexerId}:${release.guid}`;
        const current = releases.get(key);
        if (!current || release.score > current.score) releases.set(key, release);
      }

      const ranked = [...releases.values()].sort(
        (a, b) => compareByTier(a.tier, b.tier) || b.score - a.score || (b.seeders ?? -1) - (a.seeders ?? -1),
      );

      // A release matching no tier is never grabbed unattended. It stays in the picker for a person
      // to choose, which is the whole point of the untiered state: the operator said what they want,
      // and anything else is a decision they have not delegated.
      const inProfile = profiled ? ranked.filter((release) => release.tier !== null) : ranked;
      const cleared = inProfile.filter((release) => release.score >= settings.autoGrabMinScore);
      const candidates = cleared.filter((release) => !tried.has(`${release.indexerId}:${release.guid}`));

      picks = {
        candidates,
        indexers: [...indexers.values()],
        allTried: candidates.length === 0 && cleared.length > 0,
        // Only when the profile is what emptied the list. Without this the operator is told nothing
        // scored well enough, while the picker in front of them is full of releases that did.
        profileExcludedAll: profiled && inProfile.length === 0 && ranked.length > 0,
        enabledIndexerCount: result.enabledIndexerCount,
        configuredIndexerCount: result.configuredIndexerCount,
        // From whichever variant ran last. The medium filter runs before the ISBN-capable
        // narrowing, so every variant of one pass reports the same number.
        uncoveredIndexerCount: result.uncoveredIndexerCount,
      };
      if (candidates.length > 0) return picks;
    }

    return picks;
  }

  /**
   * Hands the request back to a person with the reason on it. A retry that finds nothing returns
   * to `failed`, because something did go wrong; an approval that finds nothing returns to
   * `approved`, which is exactly where an approver picks a release themselves.
   *
   * An auto-approved request is the one case where handing back is not enough. Nobody was told it
   * existed, its requester cannot open the picker, and it now sits in a queue looking like work
   * somebody has already taken. A retry is not announced here because `failDownload` has already
   * notified the approvers about the failure that set it off.
   */
  private async decline(requestId: number, trigger: AutomationTrigger, from: readonly BookRequestStatus[], handback: Handback): Promise<void> {
    // Nothing is announced unless the handback itself committed: a request somebody cancelled,
    // filed or grabbed a release for while automation was running is not one to hand back, and
    // telling the approvers it needs a release would point them at work that is already over.
    const handedBack = await this.fulfillment.setRequestStatus(
      requestId,
      trigger === 'retry' ? 'failed' : 'approved',
      handback.reason,
      { code: handback.code, meta: handback.meta },
      from,
    );

    if (!handedBack) return;
    await this.announceUnattended(
      requestId,
      trigger,
      handback.code,
      (title) => `"${title}" was approved without a decision and needs a release picked by hand`,
    );
  }

  /**
   * Tells the approvers about a request that has run out of automation, for the one trigger where
   * nobody is already watching it.
   *
   * Only `auto_approval` reaches anybody here. An approval has the approver in front of the queue,
   * and a retry was set off by a failure `failDownload` already announced; an auto-approved request
   * has neither, so this is the only thing standing between it and a row nobody knows about.
   */
  private async announceUnattended(requestId: number, trigger: AutomationTrigger, code: string, describe: (title: string) => string): Promise<void> {
    if (trigger !== 'auto_approval') return;

    const joined = await this.requests.findById(requestId);
    const title = joined?.request.title ?? `request #${requestId}`;

    this.logger.log(`[book_request.auto_grab] [end] requestId=${requestId} trigger=${trigger} code=${code} - handed back to the approvers`);

    await this.notifier.notifyApprovers(NotificationType.BookRequestNeedsRelease, {
      title: 'Book request needs a release',
      message: describe(title),
      actionUrl: '/requests',
      meta: { requestId },
    });
  }
}

interface ReleasePicks {
  candidates: ReleaseCandidateItem[];
  indexers: IndexerSearchStatus[];
  allTried: boolean;
  /** The medium has a profile and nothing the search returned fell into any of its tiers. */
  profileExcludedAll: boolean;
  /**
   * What the instance had to search with. An empty candidate list has several causes and only
   * these separate the ones a score floor cannot explain, so they travel with the picks rather
   * than being read again after the fact.
   */
  enabledIndexerCount: number;
  configuredIndexerCount: number;
  uncoveredIndexerCount: number;
}

interface AutomationSearchVariant {
  indexerMode: IndexerSearchMode;
  /** Undefined uses the request's recommended ISBN; null explicitly searches title and author. */
  isbn?: string | null;
}

/**
 * What earlier refusals in this pass have already ruled out.
 *
 * Held for the pass rather than persisted: it is a record of what just happened, not a judgement
 * about the source. A tracker that was rate limiting five seconds ago deserves the next request's
 * first attempt, and an operator who buys VIP should not have to clear a flag to use it.
 */
class BlockedSources {
  private readonly refusals: GrabRefusal[] = [];
  /** Whether a grab from each source joins a swarm, which is the same thing as needing a client. */
  private readonly seedsBack: Map<number, boolean>;

  constructor(indexers: IndexerSearchStatus[]) {
    this.seedsBack = new Map(indexers.map((indexer) => [indexer.indexerId, indexer.seedsBack]));
  }

  blocks(release: ReleaseCandidateItem): boolean {
    // A source the search never reported on cannot be shown to be a direct download, and a
    // torrent is the safer thing to assume: it is the shape that needs a client.
    const seedsBack = this.seedsBack.get(release.indexerId) ?? true;
    return findGrabRefusal({ indexerId: release.indexerId, vipOnly: release.vipOnly, seedsBack }, this.refusals) !== null;
  }

  record(release: ReleaseCandidateItem, code: GrabFailureCode): void {
    this.refusals.push({ indexerId: release.indexerId, code });
  }
}

/** The tail of the attempt log line: what the failover does with this refusal. */
function nextStepDescription(code: GrabFailureCode | null, halt: boolean): string {
  if (halt) return code === null ? 'unclassified failure, stopping here' : 'not retrying, leaving it for an approver';
  switch (code) {
    case 'GRAB_VIP_REQUIRED':
      return "skipping this source's other VIP-only releases and trying the next one";
    case 'GRAB_SOURCE_REFUSED':
    case 'GRAB_SOURCE_UNAVAILABLE':
      return "skipping this source's remaining releases and trying the next one";
    case 'GRAB_CLIENT_REFUSED':
      return 'skipping every release needing that download client and trying the next one';
    default:
      return 'trying the next release down';
  }
}

/**
 * What the request carries once the chain is over. One refusal is its own explanation; several
 * need the count, or the last sentence reads as though nothing else was tried.
 */
function summarizeFailures(failures: AttemptFailure[]): string {
  const last = failures[failures.length - 1]!;
  if (failures.length === 1) return last.message;

  const sources = new Set(failures.map((failure) => failure.indexerName)).size;
  const sourceLabel = sources === 1 ? '1 source' : `${sources} sources`;
  return `Tried ${failures.length} releases from ${sourceLabel} and none could be started. Last: ${last.message}`;
}
