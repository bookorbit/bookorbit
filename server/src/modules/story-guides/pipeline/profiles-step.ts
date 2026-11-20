import type { AiStep, AiStepContext, AiStepRequest } from '../../ai-jobs/ai-feature';
import { hashOf } from '../../ai-jobs/ai-fingerprint';
import { askForJson, parseJsonReply } from './json-reply';
import { isPlaceholder, laterNames, linesRows, linesUnits, namedLater, type LineNames, type LinesUnit } from './lines-step';
import { WORD_EDGE, nameKey, splitWords } from './name-text';
import { mergeResult, reviewResult, textResult } from './step-context';
import type { StoryGuideSubject } from './story-guide-subject';
import type {
  StoryDroppedProfile,
  StoryLinesThrough,
  StoryMergeResult,
  StoryProfileDropReason,
  StoryProfilesResult,
  StoryReviewResult,
} from './story-guide.types';
import type { TextStepResult } from './text-step';

/** What the prompt asks for. A profile is checked against `PROFILE_MAX_WORDS`, which leaves the model some slack. */
export const PROFILE_WORDS = 80;
export const PROFILE_MAX_WORDS = 100;
export const PROFILES_MAX_OUTPUT_TOKENS = 12000;
/** Other names a row lists, so the model can tell who "Albus" or "the Headmaster" is in the chapter. */
const MAX_ALIASES = 6;

export const PROFILES_SYSTEM =
  'You keep a short profile of each character in a novel, for a reader who has read up to the end of the chapter below and wants to ' +
  'recall who someone is. After the chapter come the characters who appear in it, each with the other names they go by so far and ' +
  'their current profile ("none" when new). A character may also bring the profile of an entry kept apart until now under another ' +
  'name: it is the same person, so write one profile that keeps the lasting facts of both.\n' +
  'A profile is not a summary of events. In this order, it says: who the character is (role, family, where they belong); the few ' +
  'things they have done or had happen to them that changed their place in the story; and how they come across and stand with the ' +
  'others. An event belongs in it only if it changed who they are, what they know, or how they stand with someone; a scene that ' +
  'changed nothing lasting does not. Clothes, meals, jokes and passing moods are details, not lasting facts.\n' +
  'For each character, decide whether the chapter changes any of that. When it does, write the whole profile again, in two to four ' +
  `plain sentences and at most ${PROFILE_WORDS} words. Keep every lasting fact from the current profile unless the chapter shows it ` +
  'has changed (someone died, left, lost a post, or a belief about them proved false), and then say so instead. When space runs short, ' +
  'drop a detail before a lasting fact. Someone new the chapter says little about gets one sentence. Leave out a character whose ' +
  'current profile still holds: most characters in most chapters.\n' +
  'Use only the chapter and the current profiles. Never use what you know of the book, its series or any adaptation. Write about what ' +
  'has happened and what is true now; never say what anyone will do or become unless the chapter states it as a plan. Do not guess ' +
  'or hedge: write only what the text makes clear. Do not quote the book. Call people by the names given, never "the narrator". ' +
  'Write in the language of the chapter.\n' +
  'Answer with JSON only, naming each character exactly as listed: {"profiles": [{"name": "<name>", "profile": "<profile>"}]}';

export const PROFILES_REWRITE_SYSTEM =
  'Each profile below, of a character in a novel, broke a rule. Write each again so that it follows every rule, keeping only facts it ' +
  `already states and adding nothing: at most ${PROFILE_WORDS} words; no name listed as not introduced yet; people called by name, ` +
  'never "the narrator".\n' +
  'Answer with JSON only, naming each character exactly as listed: {"profiles": [{"name": "<name>", "profile": "<profile>"}]}';

/**
 * Both requests send it, so a provider that enforces a schema always answers valid JSON. Names are
 * values, not keys: a strict schema closes every object.
 */
export const PROFILES_SCHEMA: NonNullable<AiStepRequest['schema']> = {
  type: 'object',
  properties: {
    profiles: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, profile: { type: 'string' } },
        required: ['name', 'profile'],
        additionalProperties: false,
      },
    },
  },
  required: ['profiles'],
  additionalProperties: false,
};

const NARRATOR = new RegExp(`${WORD_EDGE}the narrator${WORD_EDGE}`, 'iu');

/** One character as the profiles step sends it. */
export interface ProfilesRow {
  /** The entity its profile is kept under: a cast entity, or a member not yet joined to it. */
  entity: number;
  name: string;
  /** Its other names a reader at the end of the unit has met. */
  aliases: string[];
  current: string | null;
  /** Members joining in this unit that had a profile of their own, which the new profile takes in. */
  joined: { name: string; profile: string }[];
}

/**
 * The characters present in unit `index`, as the lines step finds them, each with the names a reader
 * at its end has met and its current profile. A member joins its entity's row from its join on,
 * bringing its profile in the unit of its join.
 */
export function profilesRows(
  index: number,
  text: Pick<TextStepResult, 'chapters' | 'passages'>,
  merge: StoryMergeResult,
  review: StoryReviewResult,
  state: ReadonlyMap<number, string>,
): ProfilesRow[] {
  const { unitOf } = linesUnits(text);
  const joinOf = new Map(review.joins.map((join) => [join.member, join]));
  const castOf = new Map(review.cast.map((entity) => [entity.id, entity]));
  return linesRows(index, text, merge, review, state).map((row) => {
    const cast = castOf.get(row.entity);
    const members = cast ? cast.members.filter((id) => id === cast.id || unitOf.get(joinOf.get(id)!.at.passage)! <= index) : [row.entity];
    const joined = members.flatMap((id) => {
      const profile = state.get(id);
      return id !== row.entity && profile && unitOf.get(joinOf.get(id)!.at.passage) === index ? [{ name: merge.entities[id].name, profile }] : [];
    });
    const seen = new Set([nameKey(row.name)]);
    const aliases: string[] = [];
    for (const id of members) {
      for (const name of merge.entities[id].names) {
        if (aliases.length === MAX_ALIASES || unitOf.get(name.at.passage)! > index || seen.has(name.key)) continue;
        seen.add(name.key);
        aliases.push(name.text);
      }
    }
    return { entity: row.entity, name: row.name, aliases, current: row.current, joined };
  });
}

/** The unit's story text: its passages in order. */
export function unitText(index: number, text: Pick<TextStepResult, 'chapters' | 'passages'>): string {
  const { unitOf } = linesUnits(text);
  return text.passages
    .filter((passage) => unitOf.get(passage.id) === index)
    .map((passage) => passage.text)
    .join('\n\n');
}

function rowLine(row: ProfilesRow): string {
  const also = row.aliases.length > 0 ? ` | also: ${row.aliases.join(', ')}` : '';
  const joined = row.joined.map((item) => ` | kept apart until now as ${item.name}: ${item.profile}`).join('');
  return `- ${row.name}${also} | current: ${row.current ?? 'none'}${joined}`;
}

export function profilesUser(chapter: string, rows: readonly ProfilesRow[]): string {
  return `<chapter>\n${chapter}\n</chapter>\n\nCharacters:\n${rows.map(rowLine).join('\n')}`;
}

export function profilesRequest(chapter: string, rows: readonly ProfilesRow[]): AiStepRequest {
  return {
    system: PROFILES_SYSTEM,
    user: profilesUser(chapter, rows),
    schema: PROFILES_SCHEMA,
    maxOutputTokens: PROFILES_MAX_OUTPUT_TOKENS,
    effort: 'medium',
  };
}

/**
 * The answer's profiles by name key, or null when it has no `profiles` list. A closing brace or
 * bracket left at the end of a profile is dropped: a schema-bound answer once ended one with `}`.
 */
export function readProfilesAnswer(answer: Record<string, unknown>): Map<string, string> | null {
  const profiles = answer.profiles;
  if (!Array.isArray(profiles)) return null;
  return new Map(
    profiles.flatMap((item: unknown) => {
      if (item === null || typeof item !== 'object') return [];
      const { name, profile } = item as Record<string, unknown>;
      return typeof name === 'string' && typeof profile === 'string' ? [[nameKey(name), profile.replace(/[\s}\]]+$/u, '')] as const] : [];
    }),
  );
}

/** Why a profile fails the checks, with what to tell the model, or null when it passes. */
export function profileProblem(profile: string, names: LineNames): { reason: StoryProfileDropReason; detail: string } | null {
  const named = namedLater(profile, names);
  if (named.length > 0) return { reason: 'names-later-entity', detail: `names ${named.join(', ')}, who has not been introduced yet` };
  if (splitWords(profile).length > PROFILE_MAX_WORDS) return { reason: 'too-long', detail: `is longer than ${PROFILE_WORDS} words` };
  if (NARRATOR.test(profile)) return { reason: 'narrator', detail: 'says "the narrator" instead of a name' };
  return null;
}

/** The one rewrite of the profiles that failed a check. It needs no chapter: it only cuts or renames. */
export function profilesRewriteRequest(failed: readonly { row: ProfilesRow; profile: string; detail: string }[]): AiStepRequest {
  const user = failed.map((item) => `- ${item.row.name}: "${item.profile}" (${item.detail})`).join('\n');
  return { system: PROFILES_REWRITE_SYSTEM, user, schema: PROFILES_SCHEMA, maxOutputTokens: PROFILES_MAX_OUTPUT_TOKENS, effort: 'medium' };
}

/** Every profile after the units so far, by entity: each unit's changes applied in order. */
export function profilesState(results: Iterable<StoryProfilesResult>): Map<number, string> {
  const state = new Map<number, string>();
  for (const result of results) for (const profile of result.profiles) state.set(profile.entity, profile.text);
  return state;
}

/**
 * Writes one unit's profiles: asks for them with the unit's text, keeps an answer only when it changes
 * a profile, and gives any profile that fails a check one rewrite before dropping it, which keeps the
 * previous profile. A character with no profile that took in a joined entry and got none keeps that
 * entry's, so the join does not leave it blank.
 */
export async function writeProfiles(
  ctx: Pick<AiStepContext, 'complete'>,
  through: StoryLinesThrough,
  chapter: string,
  rows: readonly ProfilesRow[],
  later: LineNames,
): Promise<StoryProfilesResult> {
  const result: StoryProfilesResult = { through, profiles: [], dropped: [], rewritten: 0 };
  if (rows.length === 0) return result;
  const answer = await askForJson(ctx, profilesRequest(chapter, rows), readProfilesAnswer);
  const failed: { row: ProfilesRow; profile: string; detail: string; reason: StoryProfileDropReason }[] = [];
  const written = new Set<number>();
  const accept = (row: ProfilesRow, profile: string) => {
    written.add(row.entity);
    if (profile !== row.current) result.profiles.push({ entity: row.entity, name: row.name, text: profile });
  };
  for (const row of rows) {
    const profile = answer.get(nameKey(row.name))?.trim();
    if (!profile || isPlaceholder(profile)) continue;
    const problem = profileProblem(profile, later);
    if (problem) failed.push({ row, profile, ...problem });
    else accept(row, profile);
  }

  if (failed.length > 0) {
    result.rewritten = failed.length;
    const reply = await ctx.complete(profilesRewriteRequest(failed));
    const parsed = parseJsonReply(reply.text);
    const rewritten = (parsed && readProfilesAnswer(parsed)) ?? new Map<string, string>();
    for (const item of failed) {
      const profile = rewritten.get(nameKey(item.row.name))?.trim();
      const problem = profile && !isPlaceholder(profile) ? profileProblem(profile, later) : null;
      if (profile && !isPlaceholder(profile) && !problem) accept(item.row, profile);
      else {
        const drop: StoryDroppedProfile = {
          entity: item.row.entity,
          name: item.row.name,
          text: profile || item.profile,
          reason: problem?.reason ?? item.reason,
        };
        result.dropped.push(drop);
      }
    }
  }

  for (const row of rows) {
    if (row.current === null && row.joined.length > 0 && !written.has(row.entity)) accept(row, row.joined[0].profile);
  }
  return result;
}

function earlierResults(ctx: Pick<AiStepContext, 'results'>, units: readonly LinesUnit[], index: number): StoryProfilesResult[] {
  const done = ctx.results('profiles');
  return units.slice(0, index).flatMap((unit) => (done.has(unit.id) ? [done.get(unit.id) as StoryProfilesResult] : []));
}

/** `profiles`: each character's profile, chained chapter to chapter (part to part in a long chapter), on the fast slot. */
export function profilesAiStep(): AiStep<StoryGuideSubject> {
  const prepare = (ctx: Parameters<AiStep<StoryGuideSubject>['fingerprint']>[0], id: string) => {
    const text = textResult(ctx);
    const { units } = linesUnits(text);
    const unit = units.find((item) => item.id === id);
    if (!unit) throw new Error(`No profiles unit ${id}`);
    const merge = mergeResult(ctx);
    const state = profilesState(earlierResults(ctx, units, unit.index));
    const rows = profilesRows(unit.index, text, merge, reviewResult(ctx), state);
    return { unit, text, merge, rows, chapter: rows.length > 0 ? unitText(unit.index, text) : '' };
  };
  return {
    id: 'profiles',
    version: 4,
    slot: 'fast',
    dependsOn: ['text', 'merge', 'review'],
    sequential: true,
    units: (ctx) => linesUnits(textResult(ctx)).units.map((unit) => ({ id: unit.id })),
    fingerprint: (ctx, unit) => {
      const { rows, chapter } = prepare(ctx, unit.id);
      const request = profilesRequest(chapter, rows);
      return hashOf('profiles', unit.id, request.system, request.user, PROFILES_REWRITE_SYSTEM, PROFILES_SCHEMA);
    },
    async run(ctx, unit) {
      const { unit: profilesUnit, text, merge, rows, chapter } = prepare(ctx, unit.id);
      return writeProfiles(ctx, profilesUnit.through, chapter, rows, laterNames(profilesUnit.index, text, merge));
    },
  };
}
