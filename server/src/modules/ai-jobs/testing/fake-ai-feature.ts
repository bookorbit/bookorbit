import {
  AuditResource,
  NotificationType,
  Permission,
  type AiJobEstimate,
  type AiJobFailureReason,
  type AiJobModels,
  type AiJobSubjectRef,
} from '@bookorbit/types';

import type { RequestUser } from '../../../common/types/request-user';
import { AiJobFailure, type AiFeature, type AiJobInfo, type AiNotice, type AiStep, type AiSubject } from '../ai-feature';
import { hashOf } from '../ai-fingerprint';
import { splitWhileTooLong } from '../ai-split';
import {
  AiError,
  type AiClientPort,
  type AiFeatureSettings,
  type AiHealthReason,
  type AiJobsPorts,
  type AiRequest,
  type AiResult,
  type AiSlot,
} from '../ai-jobs.ports';

export const FAKE_FEATURE_ID = 'fake-guide';

export interface FakeSubject extends AiSubject {
  passages: string[];
}

export interface FakeArtifact {
  format: number;
  names: string[];
  summary: string;
  coverage: number;
}

/**
 * Everything a test may change between runs: the books, who can reach them, and each step's
 * version. The feature reads it on every call, as a real feature reads the database.
 */
export interface FakeFeatureState {
  subjects: Map<string, FakeSubject>;
  reachable: (user: RequestUser, ref: AiJobSubjectRef) => boolean;
  versions: { text: number; names: number; summary: number };
  pipeline: string;
  /** Step and unit ids in the order they ran, across every job. */
  runs: { jobId: string; step: string; unit: string }[];
  notices: { jobId: string; outcome: string; reason: string | null }[];
}

export function createFakeFeatureState(): FakeFeatureState {
  return {
    subjects: new Map(),
    reachable: () => true,
    versions: { text: 1, names: 1, summary: 1 },
    pipeline: 'fake-1',
    runs: [],
    notices: [],
  };
}

export function fakeRef(fileId: number, bookId = fileId): AiJobSubjectRef {
  return { bookId, fileId };
}

export function fakeSubject(key: string, passages: number): FakeSubject {
  return { key, passages: Array.from({ length: passages }, (_, index) => `Passage ${index} names Person${index} and Place${index}.`) };
}

const NAMES_SCHEMA = { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] };
const SUMMARY_SCHEMA = { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] };

/**
 * Three steps shaped like a real pipeline: code that splits the text, a parallel step on the fast
 * slot, and a single careful step that reads the parallel step's results.
 */
export function createFakeAiFeature(state: FakeFeatureState, id = FAKE_FEATURE_ID): AiFeature<FakeSubject, FakeArtifact> {
  const text: AiStep<FakeSubject> = {
    id: 'text',
    get version() {
      return state.versions.text;
    },
    slot: null,
    dependsOn: [],
    units: () => [{ id: 'book' }],
    fingerprint: (ctx) => hashOf(ctx.subject.passages),
    run: (ctx, unit) => {
      state.runs.push({ jobId: ctx.job.id, step: 'text', unit: unit.id });
      return Promise.resolve({ passages: ctx.subject.passages.map((passage, index) => ({ id: `p${index}`, text: passage })) });
    },
  };

  const names: AiStep<FakeSubject> = {
    id: 'names',
    get version() {
      return state.versions.names;
    },
    slot: 'fast',
    dependsOn: ['text'],
    units: (ctx) => passagesOf(ctx.results('text')).map((passage) => ({ id: passage.id })),
    fingerprint: (ctx, unit) => hashOf('names-prompt-1', passageText(ctx.results('text'), unit.id)),
    run: async (ctx, unit) => {
      state.runs.push({ jobId: ctx.job.id, step: 'names', unit: unit.id });
      const results = await splitWhileTooLong(passageText(ctx.results('text'), unit.id), (part) =>
        ctx.complete({ system: 'List the names in the passage.', user: part, schema: NAMES_SCHEMA, maxOutputTokens: 200 }),
      );
      return { names: results.flatMap((result) => (result.json as { names: string[] }).names), version: state.versions.names };
    },
  };

  const summary: AiStep<FakeSubject> = {
    id: 'summary',
    get version() {
      return state.versions.summary;
    },
    slot: 'careful',
    dependsOn: ['names'],
    units: () => [{ id: 'all' }],
    fingerprint: () => hashOf('summary-prompt-1'),
    run: async (ctx, unit) => {
      state.runs.push({ jobId: ctx.job.id, step: 'summary', unit: unit.id });
      const result = await ctx.complete({
        system: 'Summarise the cast.',
        user: allNames(ctx.results('names')).join(', '),
        schema: SUMMARY_SCHEMA,
        maxOutputTokens: 400,
      });
      return { summary: (result.json as { summary: string }).summary };
    },
  };

  return {
    id,
    formats: [1, 2],
    get pipeline() {
      return state.pipeline;
    },
    steps: [text, names, summary],
    permission: Permission.LibraryGenerateReadAloud,
    resolveSubject: (ref) => {
      const subject = state.subjects.get(String(ref.fileId));
      if (!subject) return Promise.reject(new AiJobFailure('unreadable', 'The fake file is gone'));
      return Promise.resolve({ ...subject, passages: [...subject.passages] });
    },
    check: (subject) => Promise.resolve(subject.passages.length === 0 ? { reason: 'too-short' } : null),
    estimate: (subject): Promise<AiJobEstimate> => Promise.resolve({ words: subject.passages.length * 10, minutes: 1, cost: 0.01 }),
    assemble: (ctx) =>
      Promise.resolve({
        format: ctx.format,
        names: allNames(ctx.results('names')),
        summary: (ctx.results('summary').get('all') as { summary: string } | undefined)?.summary ?? '',
        coverage: ctx.coverage,
      }),
    render: (artifact, format) => (format === 1 ? { ...artifact, format: 1 } : format === 2 ? artifact : null),
    canReach: (user, ref) => Promise.resolve(state.reachable(user, ref)),
    describe: (refs) =>
      Promise.resolve(
        new Map(
          [...refs].map(([jobId, ref]) => [
            jobId,
            { label: `Book ${String(ref.bookId)}`, byline: null, url: `/book/${String(ref.bookId)}`, image: null },
          ]),
        ),
      ),
    notice: (job: AiJobInfo, outcome, reason: AiJobFailureReason | null): Promise<AiNotice | null> => {
      state.notices.push({ jobId: job.id, outcome, reason });
      return Promise.resolve({
        type: outcome === 'completed' ? NotificationType.ReadAloudReady : NotificationType.ReadAloudFailed,
        title: outcome === 'completed' ? 'Fake guide ready' : 'Fake guide failed',
        actionUrl: `/book/${String(job.subjectRef.bookId)}`,
        meta: { bookId: job.subjectRef.bookId },
      });
    },
    auditTarget: (ref) => ({ resource: AuditResource.Book, resourceId: Number(ref.bookId) }),
  };
}

function passagesOf(results: ReadonlyMap<string, unknown>): { id: string; text: string }[] {
  return (results.get('book') as { passages: { id: string; text: string }[] } | undefined)?.passages ?? [];
}

function passageText(results: ReadonlyMap<string, unknown>, id: string): string {
  return passagesOf(results).find((passage) => passage.id === id)?.text ?? '';
}

function allNames(results: ReadonlyMap<string, unknown>): string[] {
  return [...results.entries()]
    .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
    .flatMap(([, value]) => (value as { names: string[] }).names);
}

export type FakeHandler = (request: AiRequest) => AiResult | Promise<AiResult>;

/**
 * Answers like a provider that follows the schema: the passage's capitalised words as names, and the
 * names joined as a summary. A test swaps `handler` to refuse, fail or hang.
 */
export class FakeAiClient implements AiClientPort {
  readonly calls: AiRequest[] = [];
  handler: FakeHandler = (request) => defaultAnswer(request);

  async complete(request: AiRequest): Promise<AiResult> {
    if (request.signal?.aborted) throw new AiError('cancelled');
    this.calls.push(request);
    return await this.handler(request);
  }

  callsFor(slot: AiSlot): AiRequest[] {
    return this.calls.filter((call) => call.slot === slot);
  }
}

export function defaultAnswer(request: AiRequest, usage: Partial<AiResult['usage']> = {}): AiResult {
  const json =
    request.slot === 'fast'
      ? {
          names: request.user
            .split(/\s+/)
            .filter((word) => /^[A-Z][a-z]+\d+$/.test(word.replace(/[.,]$/, '')))
            .map((word) => word.replace(/[.,]$/, '')),
        }
      : { summary: `Cast: ${request.user}` };
  return {
    text: JSON.stringify(json),
    json,
    usage: { input: 100, output: 20, cost: 0.0001, ...usage },
    finish: 'stop',
    model: `${request.slot}-model`,
  };
}

/** Hangs until the request's signal aborts, like a slow provider. */
export function hangUntilAborted(request: AiRequest): Promise<AiResult> {
  return new Promise((_resolve, reject) => {
    if (request.signal?.aborted) return reject(new AiError('cancelled'));
    request.signal?.addEventListener('abort', () => reject(new AiError('cancelled')), { once: true });
  });
}

export interface FakePortsState {
  settings: AiFeatureSettings;
  models: AiJobModels;
  missing: AiSlot[];
  health: AiHealthReason | null;
  retestHealth: AiHealthReason | null | undefined;
  budget: 'ok' | 'budget';
  reserved: Set<string>;
  released: string[];
  reservations: { jobId: string; feature: string; amount: number | null }[];
}

export function createFakePorts(client: FakeAiClient = new FakeAiClient()): { ports: AiJobsPorts; state: FakePortsState; client: FakeAiClient } {
  const state: FakePortsState = {
    settings: { enabled: true, buildsAtOnce: 1 },
    models: { fast: { connectionId: 1, model: 'fast-model' }, careful: { connectionId: 1, model: 'careful-model' } },
    missing: [],
    health: null,
    retestHealth: undefined,
    budget: 'ok',
    reserved: new Set(),
    released: [],
    reservations: [],
  };
  const ports: AiJobsPorts = {
    client,
    slots: {
      resolve: (_feature, slots) =>
        Promise.resolve({
          models: Object.fromEntries(
            slots.filter((slot) => !state.missing.includes(slot) && state.models[slot]).map((slot) => [slot, state.models[slot]!]),
          ),
          missing: slots.filter((slot) => state.missing.includes(slot) || !state.models[slot]),
        }),
    },
    health: {
      check: () => Promise.resolve(state.health),
      retest: () => Promise.resolve(state.retestHealth === undefined ? state.health : state.retestHealth),
    },
    budget: {
      reserve: (input) => {
        state.reservations.push(input);
        if (state.budget === 'budget') return Promise.resolve({ ok: false, reason: 'budget' });
        state.reserved.add(input.jobId);
        return Promise.resolve({ ok: true });
      },
      release: (jobId) => {
        state.reserved.delete(jobId);
        state.released.push(jobId);
        return Promise.resolve();
      },
    },
    settings: { get: () => Promise.resolve({ ...state.settings }) },
  };
  return { ports, state, client };
}
