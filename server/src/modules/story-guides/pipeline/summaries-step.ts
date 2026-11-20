import type { AiRunContext, AiStep, AiStepContext, AiStepRequest } from '../../ai-jobs/ai-feature';
import { hashOf } from '../../ai-jobs/ai-fingerprint';
import { askForJson, parseJsonReply } from './json-reply';
import { isPlaceholder, laterNames, linesUnits, namedLater, type LineNames, type LinesUnit } from './lines-step';
import { storyLexicon } from './story-lexicon';
import { splitWords } from './name-text';
import { unitText } from './profiles-step';
import { mergeResult, textResult } from './step-context';
import type { StoryGuideSubject } from './story-guide-subject';
import type { StoryLinesThrough, StorySummaryDropReason, StorySummaryResult } from './story-guide.types';

/** What the prompt asks for. A summary is checked against `SUMMARY_MAX_WORDS`, which leaves the model some slack. */
export const SUMMARY_WORDS = 90;
export const SUMMARY_MAX_WORDS = 120;
export const SUMMARIES_MAX_OUTPUT_TOKENS = 6000;

export const SUMMARIES_SYSTEM =
  'You write a short summary of one stretch of a novel, for a reader who has just read it and wants to recall what happened. The ' +
  'stretch is a chapter, or one part of a long chapter, given between <chapter> tags. Before it may come, between <before> tags, the ' +
  'summary of the stretch just before it: use that only to know who people are and to keep the story joined up, and do not retell it.\n' +
  `Write two to four plain sentences, at most ${SUMMARY_WORDS} words, on what happens in this stretch alone: the main events, who ` +
  'takes part, and what has changed by its end. Leave out small details such as clothes, meals and passing moods.\n' +
  'Use only the chapter and the summary before it. Never use what you know of the book, its series or any adaptation. Name only ' +
  'people, places and things that the chapter or the summary before it names, by the names used there. Never say who someone really ' +
  'is before the text does, and never say what will happen later. Do not guess or hedge: write only what the text makes clear. Do ' +
  'not quote the book. Call whoever tells the story as "I" by name once the text has named them. Write in the language of the chapter.\n' +
  'When the stretch tells no story (a list of contents, a dedication, notes), answer with an empty summary.\n' +
  'Answer with JSON only: {"summary": "<summary>"}';

export const SUMMARIES_REWRITE_SYSTEM =
  'The summary below, of one stretch of a novel, broke a rule. Write it again so that it follows every rule, keeping only facts it ' +
  `already states and adding nothing: at most ${SUMMARY_WORDS} words; no name listed as not introduced yet. Keep the language of the ` +
  'summary.\n' +
  'Answer with JSON only: {"summary": "<summary>"}';

/** Both requests send it, so a provider that enforces a schema always answers valid JSON. */
export const SUMMARIES_SCHEMA: NonNullable<AiStepRequest['schema']> = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
};

export function summariesUser(chapter: string, previous: string | null): string {
  const before = previous ? `<before>\n${previous}\n</before>\n\n` : '';
  return `${before}<chapter>\n${chapter}\n</chapter>`;
}

export function summariesRequest(chapter: string, previous: string | null): AiStepRequest {
  return {
    system: SUMMARIES_SYSTEM,
    user: summariesUser(chapter, previous),
    schema: SUMMARIES_SCHEMA,
    maxOutputTokens: SUMMARIES_MAX_OUTPUT_TOKENS,
    effort: 'medium',
  };
}

/**
 * The answer's summary, empty for a stretch with no story, or null when it has no `summary` string.
 * A closing brace or bracket left at its end is dropped, as the profiles step does.
 */
export function readSummaryAnswer(answer: Record<string, unknown>): string | null {
  const summary = answer.summary;
  return typeof summary === 'string' ? summary.replace(/[\s}\]]+$/u, '').trim() : null;
}

/** Why a summary fails the checks, with what to tell the model, or null when it passes. */
export function summaryProblem(summary: string, names: LineNames): { reason: StorySummaryDropReason; detail: string } | null {
  const named = namedLater(summary, names);
  if (named.length > 0) return { reason: 'names-later-entity', detail: `names ${named.join(', ')}, not introduced yet` };
  if (splitWords(summary).length > SUMMARY_MAX_WORDS) return { reason: 'too-long', detail: `is longer than ${SUMMARY_WORDS} words` };
  return null;
}

/** The one rewrite of a summary that failed a check. It needs no chapter: it only cuts or renames. */
export function summariesRewriteRequest(summary: string, detail: string): AiStepRequest {
  return {
    system: SUMMARIES_REWRITE_SYSTEM,
    user: `"${summary}" (${detail})`,
    schema: SUMMARIES_SCHEMA,
    maxOutputTokens: SUMMARIES_MAX_OUTPUT_TOKENS,
    effort: 'medium',
  };
}

/**
 * Writes one unit's summary from its text and the summary before it. A summary that fails a check
 * gets one rewrite; one that fails again is left out, never replaced by anything the code writes.
 */
export async function writeSummary(
  ctx: Pick<AiStepContext, 'complete'>,
  through: StoryLinesThrough,
  chapter: string,
  previous: string | null,
  later: LineNames,
): Promise<StorySummaryResult> {
  const result: StorySummaryResult = { through, text: null, dropped: null, rewritten: false };
  if (!chapter.trim()) return result;
  const summary = await askForJson(ctx, summariesRequest(chapter, previous), readSummaryAnswer);
  if (!summary || isPlaceholder(summary, later.lexicon)) return result;
  const problem = summaryProblem(summary, later);
  if (!problem) return { ...result, text: summary };

  result.rewritten = true;
  const reply = await ctx.complete(summariesRewriteRequest(summary, problem.detail));
  const parsed = parseJsonReply(reply.text);
  const rewritten = parsed ? readSummaryAnswer(parsed) : null;
  const usable = rewritten && !isPlaceholder(rewritten, later.lexicon) ? rewritten : null;
  const again = usable ? summaryProblem(usable, later) : null;
  if (usable && !again) return { ...result, text: usable };
  result.dropped = { text: usable ?? summary, reason: again?.reason ?? problem.reason };
  return result;
}

/** The newest summary written before unit `index`; a unit left out or with none passes on the one before it. */
export function previousSummary(ctx: Pick<AiRunContext, 'results'>, units: readonly LinesUnit[], index: number): string | null {
  const done = ctx.results('summaries');
  for (let at = index - 1; at >= 0; at--) {
    const text = (done.get(units[at].id) as StorySummaryResult | undefined)?.text;
    if (text) return text;
  }
  return null;
}

/**
 * `summaries`: what happens in each unit of the `lines` step, chained chapter to chapter (part to
 * part in a long chapter) so each sees the summary before it, on the fast slot. It reads the merge
 * only for the names a summary must not use yet.
 */
export function summariesAiStep(): AiStep<StoryGuideSubject> {
  const prepare = (ctx: Parameters<AiStep<StoryGuideSubject>['fingerprint']>[0], id: string) => {
    const text = textResult(ctx);
    const { units } = linesUnits(text);
    const unit = units.find((item) => item.id === id);
    if (!unit) throw new Error(`No summaries unit ${id}`);
    return { unit, text, chapter: unitText(unit.index, text), previous: previousSummary(ctx, units, unit.index) };
  };
  return {
    id: 'summaries',
    version: 1,
    slot: 'fast',
    dependsOn: ['text', 'merge'],
    sequential: true,
    optional: true,
    units: (ctx) => linesUnits(textResult(ctx)).units.map((unit) => ({ id: unit.id })),
    fingerprint: (ctx, unit) => {
      const { chapter, previous } = prepare(ctx, unit.id);
      const request = summariesRequest(chapter, previous);
      return hashOf('summaries', unit.id, request.system, request.user, SUMMARIES_REWRITE_SYSTEM, SUMMARIES_SCHEMA);
    },
    async run(ctx, unit) {
      const { unit: summaryUnit, text, chapter, previous } = prepare(ctx, unit.id);
      return writeSummary(
        ctx,
        summaryUnit.through,
        chapter,
        previous,
        laterNames(summaryUnit.index, text, mergeResult(ctx), storyLexicon(ctx.subject.text.language)),
      );
    },
  };
}
