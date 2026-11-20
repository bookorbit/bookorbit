import type { AiStep, AiStepContext, AiStepRequest } from '../../ai-jobs/ai-feature';
import { hashOf } from '../../ai-jobs/ai-fingerprint';
import { askForJson, parseJsonReply } from './json-reply';
import { entityKind } from './merge-step';
import { WORD_CHAR, escapeRegExp, isNumberOnly, nameKey, splitWords, stripChars } from './name-text';
import { mergeResult, passageOrder, reviewResult, textResult } from './step-context';
import { ENGLISH_STORY_LEXICON, storyLexicon, writingIn, type StoryLexicon } from './story-lexicon';
import type { StoryGuideSubject } from './story-guide-subject';
import type {
  StoryDroppedLine,
  StoryLineChange,
  StoryLineDropReason,
  StoryLinesResult,
  StoryLinesThrough,
  StoryMergeResult,
  StoryReviewResult,
} from './story-guide.types';
import type { TextStepResult } from './text-step';

export const LINES_SYSTEM =
  'Below are characters of a novel who appear in the chapter just read. Each has its current identity line ("none" when new) and notes ' +
  'from the chapters read so far; notes from the chapter just read start with "new:".\n' +
  'An identity line says who someone is in the story in at most twelve words, built only from facts the notes state: role or job, family ' +
  'ties, school, unit or group, who or what they own or are bonded to, where they live.\n' +
  'Keep the current line exactly as it is unless the new notes add a lasting fact of that kind or show the line is wrong; then write a new ' +
  'line that keeps the facts that are still true. When the new notes show a fact has changed (the person died, left, lost a post, grew ' +
  'older, or a belief about them proved false), the new line states the change and drops the old fact. Leave out scene events, opinions ' +
  'and guesses, and never add anything the notes do not say, even if you know the book or its series. When the notes say little, keep the ' +
  'line short. Never hedge ("his sister or cousin"): write only what the notes make certain. Use the names exactly as given.\n' +
  'Answer with JSON only: {"lines": {"<name>": "<identity line>"}}';

export const LINES_MAX_OUTPUT_TOKENS = 8000;
export const LINE_WORDS = 12;
/** A character's notes beyond this many keep their first six and last eight. */
const MAX_NOTES = 14;

/** A chapter, or one part of a long chapter: the lines step's unit, in reading order. */
export interface LinesUnit {
  id: string;
  index: number;
  through: StoryLinesThrough;
}

/** The units in order, and the unit each passage's content belongs to: the first whose end is at or after the passage's. */
export function linesUnits(text: Pick<TextStepResult, 'chapters' | 'passages'>): { units: LinesUnit[]; unitOf: Map<string, number> } {
  const units: LinesUnit[] = [];
  const unitOf = new Map<string, number>();
  for (const chapter of text.chapters) {
    const first = units.length;
    const parts = chapter.parts.length > 1 ? chapter.parts : [];
    if (parts.length === 0) units.push({ id: `c${chapter.number}`, index: units.length, through: { chapter: chapter.number, part: null } });
    for (const part of parts) {
      units.push({ id: `c${chapter.number}p${part.part}`, index: units.length, through: { chapter: chapter.number, part: part.part } });
    }
    for (const passage of text.passages.filter((item) => item.chapter === chapter.number)) {
      const at = parts.findIndex((part) => passage.end <= part.end);
      unitOf.set(passage.id, first + (parts.length === 0 ? 0 : at < 0 ? parts.length - 1 : at));
    }
  }
  return { units, unitOf };
}

/** One character as the lines step sends it. */
export interface LinesRow {
  /** The entity its line is kept under: a cast entity, or a member not yet joined to it. */
  entity: number;
  name: string;
  current: string | null;
  notes: string[];
}

/**
 * The characters a reader at the end of unit `index` has met who appear in that unit, each with its
 * current line and notes. A member joins its entity's row from its join on, its notes counting as
 * new there; before that it is a character of its own.
 */
export function linesRows(
  index: number,
  text: Pick<TextStepResult, 'chapters' | 'passages'>,
  merge: StoryMergeResult,
  review: StoryReviewResult,
  state: ReadonlyMap<number, string>,
): LinesRow[] {
  const { unitOf } = linesUnits(text);
  const order = passageOrder(text);
  const joinOf = new Map(review.joins.map((join) => [join.member, join]));
  const rows: LinesRow[] = [];
  for (const entity of review.cast) {
    const joined = entity.members.filter((id) => id !== entity.id && unitOf.get(joinOf.get(id)!.at.passage)! <= index);
    const sets: { head: number; members: number[] }[] = [
      { head: entity.id, members: [entity.id, ...joined] },
      ...entity.members.filter((id) => id !== entity.id && !joined.includes(id)).map((id) => ({ head: id, members: [id] })),
    ];
    for (const { head, members } of sets) {
      const kind = head === entity.id ? entity.kind : entityKind(merge.entities[head]);
      if (kind !== 'character') continue;
      if (!members.some((id) => merge.entities[id].passages.some((passage) => unitOf.get(passage) === index))) continue;
      const notes: { order: number; text: string; fresh: boolean }[] = [];
      for (const id of members) {
        const join = id === head ? undefined : joinOf.get(id);
        const floor = join ? order.get(join.at.passage)! : -1;
        for (const what of merge.entities[id].what) {
          if (!what.text || unitOf.get(what.passage)! > index) continue;
          const at = Math.max(order.get(what.passage)!, floor);
          const fresh = unitOf.get(what.passage) === index || (join !== undefined && unitOf.get(join.at.passage) === index);
          notes.push({ order: at, text: what.text, fresh });
        }
      }
      notes.sort((a, b) => a.order - b.order || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
      const seen = new Set<string>();
      let kept = notes.filter((note) => !seen.has(note.text.toLowerCase()) && seen.add(note.text.toLowerCase()));
      if (kept.length > MAX_NOTES) kept = [...kept.slice(0, 6), ...kept.slice(-8)];
      rows.push({
        entity: head,
        name: merge.entities[head].name,
        current: state.get(head) ?? null,
        notes: kept.map((note) => (note.fresh ? 'new: ' : '') + note.text),
      });
    }
  }
  return rows;
}

export function linesUser(rows: readonly LinesRow[]): string {
  return rows.map((row) => `- ${row.name} | current: ${row.current ?? 'none'} | notes: ${row.notes.join('; ')}`).join('\n');
}

function linesSystem(lexicon: StoryLexicon): string {
  return writingIn(LINES_SYSTEM, lexicon, 'every identity line');
}

export function linesRequest(rows: readonly LinesRow[], lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): AiStepRequest {
  return { system: linesSystem(lexicon), user: linesUser(rows), maxOutputTokens: LINES_MAX_OUTPUT_TOKENS, effort: 'medium' };
}

/** The answer's lines by name key, or null when it has no `lines` object. */
export function readLinesAnswer(answer: Record<string, unknown>): Map<string, string> | null {
  const lines = answer.lines;
  if (lines === null || typeof lines !== 'object' || Array.isArray(lines)) return null;
  return new Map(
    Object.entries(lines as Record<string, unknown>).flatMap(([name, line]) => (typeof line === 'string' ? [[nameKey(name), line] as const] : [])),
  );
}

/** "none", "unknown" and the like are not lines. */
export function isPlaceholder(line: string, lexicon: StoryLexicon = ENGLISH_STORY_LEXICON): boolean {
  return lexicon.placeholder.test(stripChars(line.trim(), ' .,\'’"()-'));
}

/** A name and the pattern that finds it in a line, apostrophes folded. */
export interface LineName {
  text: string;
  pattern: RegExp;
}

/** What a line written at the end of a unit may and may not name. */
export interface LineNames {
  /** Names of entities first anchored after the unit that no name seen by then shares. */
  later: LineName[];
  /** Every name seen by the end of the unit: a later name inside one of these ("John" in "John Ferrier") is that name. */
  visible: LineName[];
  /** The book's lexicon, for the checks on what is written; English when absent. */
  lexicon?: StoryLexicon;
}

function lineName(name: string): LineName {
  return { text: name, pattern: new RegExp(`(?<!${WORD_CHAR})${escapeRegExp(name.replace(/’/g, "'"))}(?!${WORD_CHAR})`, 'gu') };
}

/**
 * The names a line written at the end of unit `index` must not use: those of entities first anchored
 * after it. A name some entity has shown by then is not one of them, and names made only of titles,
 * role words or numbers say nothing on their own and are left out.
 */
export function laterNames(
  index: number,
  text: Pick<TextStepResult, 'chapters' | 'passages'>,
  merge: StoryMergeResult,
  lexicon: StoryLexicon = ENGLISH_STORY_LEXICON,
): LineNames {
  const { unitOf } = linesUnits(text);
  const firstUnit = new Map<string, { unit: number; text: string }>();
  for (const entity of merge.entities) {
    for (const name of entity.names) {
      const unit = unitOf.get(name.at.passage)!;
      const known = firstUnit.get(name.key);
      if (!known || unit < known.unit) firstUnit.set(name.key, { unit, text: name.text });
    }
  }
  const generic = new Set([...lexicon.titles, ...lexicon.namePrefixWords, ...lexicon.honorificOnly, ...lexicon.familyAndRoleWords]);
  const later = new Map<string, string>();
  for (const entity of merge.entities) {
    if (unitOf.get(entity.first)! <= index) continue;
    for (const name of entity.names) {
      if (firstUnit.get(name.key)!.unit <= index || isNumberOnly(name.text, lexicon.numberOnly)) continue;
      if (name.key.split(' ').every((word) => generic.has(word))) continue;
      if (!later.has(name.key)) later.set(name.key, name.text);
    }
  }
  return {
    later: [...later.values()].map(lineName),
    visible: [...firstUnit.values()].filter((name) => name.unit <= index).map((name) => lineName(name.text)),
    lexicon,
  };
}

/** The later names a line uses, other than inside a name seen by then. */
export function namedLater(line: string, names: LineNames): string[] {
  const folded = line.replace(/’/g, "'");
  let visible: [number, number][] | null = null;
  return names.later
    .filter((name) =>
      [...folded.matchAll(name.pattern)].some((match) => {
        const start = match.index;
        const end = start + match[0].length;
        visible ??= names.visible.flatMap((seen) =>
          [...folded.matchAll(seen.pattern)].map((hit): [number, number] => [hit.index, hit.index + hit[0].length]),
        );
        return !visible.some(([from, to]) => from <= start && end <= to);
      }),
    )
    .map((name) => name.text);
}

/** Why a line fails the checks, with what to tell the model, or null when it passes. */
export function lineProblem(line: string, names: LineNames): { reason: StoryLineDropReason; detail: string } | null {
  const named = namedLater(line, names);
  if (named.length > 0) return { reason: 'names-later-entity', detail: `names ${named.join(', ')}, who the notes have not introduced yet` };
  if (splitWords(line).length > LINE_WORDS) return { reason: 'too-long', detail: 'is longer than twelve words' };
  const lexicon = names.lexicon ?? ENGLISH_STORY_LEXICON;
  if (lexicon.hedge.test(line)) return { reason: 'hedged', detail: 'hedges with "or"' };
  if (lexicon.narrator.test(line)) return { reason: 'narrator', detail: 'says "the narrator" instead of a name' };
  return null;
}

/** The one rewrite of the lines that failed a check. */
export function linesRewriteRequest(
  rows: readonly LinesRow[],
  failed: readonly { row: LinesRow; line: string; detail: string }[],
  lexicon: StoryLexicon = ENGLISH_STORY_LEXICON,
): AiStepRequest {
  const user =
    linesUser(failed.map((item) => item.row)) +
    '\n\nThese lines broke a rule. Write each again, following every rule above:\n' +
    failed.map((item) => `- ${item.row.name}: "${item.line}" (${item.detail})`).join('\n');
  return { system: linesSystem(lexicon), user, maxOutputTokens: LINES_MAX_OUTPUT_TOKENS, effort: 'medium' };
}

/** Every line after the units so far, by entity: each unit's changes applied in order. */
export function linesState(results: Iterable<StoryLinesResult>): Map<number, string> {
  const state = new Map<number, string>();
  for (const result of results) for (const line of result.lines) state.set(line.entity, line.text);
  return state;
}

/**
 * Writes one unit's lines: asks for them, keeps an answer only when it changes a line, and gives any
 * line that fails a check one rewrite before dropping it, which keeps the previous line.
 */
export async function writeLines(
  ctx: Pick<AiStepContext, 'complete'>,
  through: StoryLinesThrough,
  rows: readonly LinesRow[],
  later: LineNames,
): Promise<StoryLinesResult> {
  const result: StoryLinesResult = { through, lines: [], dropped: [], rewritten: 0 };
  if (rows.length === 0) return result;
  const lexicon = later.lexicon ?? ENGLISH_STORY_LEXICON;
  const answer = await askForJson(ctx, linesRequest(rows, lexicon), readLinesAnswer);
  const failed: { row: LinesRow; line: string; detail: string; reason: StoryLineDropReason }[] = [];
  const accept = (row: LinesRow, line: string) => {
    if (line !== row.current) result.lines.push({ entity: row.entity, name: row.name, text: line });
  };
  for (const row of rows) {
    const line = answer.get(nameKey(row.name))?.trim();
    if (!line || isPlaceholder(line, lexicon)) continue;
    const problem = lineProblem(line, later);
    if (problem) failed.push({ row, line, ...problem });
    else accept(row, line);
  }
  if (failed.length === 0) return result;

  result.rewritten = failed.length;
  const reply = await ctx.complete(linesRewriteRequest(rows, failed, lexicon));
  const parsed = parseJsonReply(reply.text);
  const rewritten = (parsed && readLinesAnswer(parsed)) ?? new Map<string, string>();
  for (const item of failed) {
    const line = rewritten.get(nameKey(item.row.name))?.trim();
    const problem = line && !isPlaceholder(line, lexicon) ? lineProblem(line, later) : null;
    if (line && !isPlaceholder(line, lexicon) && !problem) accept(item.row, line);
    else {
      const drop: StoryDroppedLine = {
        entity: item.row.entity,
        name: item.row.name,
        text: line || item.line,
        reason: problem?.reason ?? item.reason,
      };
      result.dropped.push(drop);
    }
  }
  return result;
}

/** The lines results so far, in unit order. */
function earlierResults(ctx: Pick<AiStepContext, 'results'>, units: readonly LinesUnit[], index: number): StoryLinesResult[] {
  const done = ctx.results('lines');
  return units.slice(0, index).flatMap((unit) => (done.has(unit.id) ? [done.get(unit.id) as StoryLinesResult] : []));
}

/** `lines`: each character's line, chained chapter to chapter (part to part in a long chapter), on the fast slot. */
export function linesAiStep(): AiStep<StoryGuideSubject> {
  const prepare = (ctx: Parameters<AiStep<StoryGuideSubject>['fingerprint']>[0], id: string) => {
    const text = textResult(ctx);
    const { units } = linesUnits(text);
    const unit = units.find((item) => item.id === id);
    if (!unit) throw new Error(`No lines unit ${id}`);
    const merge = mergeResult(ctx);
    const state = linesState(earlierResults(ctx, units, unit.index));
    return { unit, text, merge, rows: linesRows(unit.index, text, merge, reviewResult(ctx), state) };
  };
  return {
    id: 'lines',
    version: 1,
    slot: 'fast',
    dependsOn: ['text', 'merge', 'review'],
    sequential: true,
    units: (ctx) => linesUnits(textResult(ctx)).units.map((unit) => ({ id: unit.id })),
    fingerprint: (ctx, unit) => {
      const { rows } = prepare(ctx, unit.id);
      const request = linesRequest(rows, storyLexicon(ctx.subject.text.language));
      return hashOf('lines', unit.id, request.system, request.user);
    },
    async run(ctx, unit) {
      const { unit: linesUnit, text, merge, rows } = prepare(ctx, unit.id);
      return writeLines(ctx, linesUnit.through, rows, laterNames(linesUnit.index, text, merge, storyLexicon(ctx.subject.text.language)));
    },
  };
}

/** Lines written so far that name an entity no reader at their end has met, for tests and the log. */
export function lineLeaks(
  results: readonly StoryLinesResult[],
  text: Pick<TextStepResult, 'chapters' | 'passages'>,
  merge: StoryMergeResult,
): { through: StoryLinesThrough; line: StoryLineChange; names: string[] }[] {
  const { units } = linesUnits(text);
  return results.flatMap((result) => {
    const index = units.findIndex((unit) => unit.through.chapter === result.through.chapter && unit.through.part === result.through.part);
    const names = laterNames(index, text, merge);
    return result.lines.flatMap((line) => {
      const named = namedLater(line.text, names);
      return named.length > 0 ? [{ through: result.through, line, names: named }] : [];
    });
  });
}
