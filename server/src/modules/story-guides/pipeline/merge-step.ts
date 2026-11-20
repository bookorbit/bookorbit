import type { StoryGuideEntityKind } from '@bookorbit/types';

import type { AiStep } from '../../ai-jobs/ai-feature';
import { hashOf } from '../../ai-jobs/ai-fingerprint';
import { mostCommon, nameKey, namesConflict, ownWords } from './name-text';
import { namesResults, textResult } from './step-context';
import type { StoryGuideSubject } from './story-guide-subject';
import type { PassageSpan, StoryMergedEntity, StoryMergeResult, StoryNamesResult } from './story-guide.types';
import type { StoryPassage } from './text-step';

interface Building extends Omit<StoryMergedEntity, 'names'> {
  names: Map<string, { text: string; at: PassageSpan }>;
}

/** The kind most of an entity's entries gave, ties going to the first. */
export function entityKind(entity: Pick<StoryMergedEntity, 'kinds'>): StoryGuideEntityKind {
  return mostCommon(entity.kinds.map((item) => item.kind)) ?? 'idea';
}

/**
 * Joins the passages' entries into entities, in reading order and never looking ahead. An entry
 * joins an entity when its name is that entity's name or one of its names, or one of its aliases is
 * that entity's name; aliases that merely overlap never join ("Potter"). "House X" and "X" join when
 * both are groups. A bare first name goes to the person its entry names in full, or, when several
 * people share it, to the one seen last in the chapter. A full name never joins a person whose name
 * conflicts with it, and a person never collects another person's name as an alias.
 */
export function mergeNames(passages: readonly StoryPassage[], names: ReadonlyMap<string, StoryNamesResult>): StoryMergeResult {
  const entities: Building[] = [];
  const byName = new Map<string, number>();
  const byAlias = new Map<string, Set<number>>();
  const firstNames = new Map<string, Set<number>>();
  const lastSeen = new Map<number, { chapter: number; index: number }>();
  const placement: Record<string, Record<string, number>> = {};
  const person = (id: number) => entities[id].kinds.filter((item) => item.kind === 'character').length * 2 > entities[id].kinds.length;
  const groupOnly = (id: number) => entityKind(entities[id]) === 'group';

  passages.forEach((passage, index) => {
    const result = names.get(passage.id);
    if (!result) return;
    const placed: Record<string, number> = (placement[passage.id] = {});
    for (const entry of result.entries) {
      const all = [entry.name, ...entry.aliases];
      let target = byName.get(nameKey(entry.name));
      const own = ownWords(entry.name);
      if (own.length === 1 && entry.kind === 'character') {
        const specific = new Set(
          entry.aliases.flatMap((alias) => {
            const id = byName.get(nameKey(alias));
            return id !== undefined && ownWords(alias).length >= 2 && ownWords(alias).includes(own[0]) ? [id] : [];
          }),
        );
        const people = [...(firstNames.get(own[0]) ?? [])].sort((a, b) => a - b);
        const recent = people.filter((id) => lastSeen.get(id)?.chapter === passage.chapter);
        if (specific.size === 1) target = [...specific][0];
        else if (new Set(people.map((id) => ownWords(entities[id].name).at(-1))).size >= 2 && recent.length > 0) {
          target = recent.reduce((best, id) => (lastSeen.get(id)!.index > lastSeen.get(best)!.index ? id : best));
        }
      }
      if (target === undefined) {
        const hits = new Set(entry.aliases.flatMap((alias) => (byName.has(nameKey(alias)) ? [byName.get(nameKey(alias))!] : [])));
        for (const id of byAlias.get(nameKey(entry.name)) ?? []) hits.add(id);
        target = hits.size === 1 ? [...hits][0] : undefined;
        if (target !== undefined && entry.kind === 'character' && own.length >= 2) {
          const theirs = ownWords(entities[target].name);
          if (namesConflict(own, theirs.length > 0 ? theirs : own)) target = undefined;
        }
      }
      if (target === undefined && entry.kind === 'group') target = houseOf(nameKey(entry.name), byName, byAlias, groupOnly);
      if (target === undefined) {
        target = entities.length;
        entities.push({ id: target, name: entry.name, first: passage.id, names: new Map(), kinds: [], what: [], passages: [] });
        byName.set(nameKey(entry.name), target);
      }
      const entity = entities[target];
      const entityWords = ownWords(entity.name);
      if (entry.kind === 'character' && entityWords.length >= 2) add(firstNames, entityWords[0], target);
      const mine = entry.kind === 'character' ? entityWords : [];
      for (const name of all) {
        const key = nameKey(name);
        const other = byName.get(key);
        const theirs = ownWords(name);
        if (name !== entry.name && mine.length > 0) {
          const anotherPerson = other !== undefined && other !== target && person(other) && theirs.length >= 2 && namesConflict(mine, theirs);
          const sharers = [...(firstNames.get(theirs[0]) ?? [])].filter((id) => id !== target);
          const anotherFirstName =
            key.split(' ').length === 1 &&
            theirs.length > 0 &&
            !mine.includes(theirs[0]) &&
            sharers.length > 0 &&
            sharers.every((id) => namesConflict(mine, ownWords(entities[id].name)));
          if (anotherPerson || anotherFirstName) continue;
        }
        if (!entity.names.has(key)) {
          entity.names.set(key, { text: entry.at[name].text, at: entry.at[name] });
          add(byAlias, key, target);
        }
      }
      lastSeen.set(target, { chapter: passage.chapter, index });
      for (const name of all) placed[nameKey(name)] ??= target;
      if (result.narrator === entry.name) entity.narrated = (entity.narrated ?? 0) + 1;
      entity.kinds.push({ passage: passage.id, kind: entry.kind });
      entity.what.push({ passage: passage.id, text: entry.what });
      if (entity.passages.at(-1) !== passage.id) entity.passages.push(passage.id);
    }
  });

  return {
    entities: entities.map((entity) => ({ ...entity, names: [...entity.names].map(([key, name]) => ({ key, ...name })) })),
    placement,
  };
}

/**
 * The group a "House X" entry belongs with ("X" or "Xs"), or the house a one-word group entry
 * belongs with, when both are groups.
 */
function houseOf(
  key: string,
  byName: ReadonlyMap<string, number>,
  byAlias: ReadonlyMap<string, ReadonlySet<number>>,
  isGroup: (id: number) => boolean,
): number | undefined {
  const words = key.split(' ');
  const named = (name: string) => {
    const ids = new Set([...(byName.has(name) ? [byName.get(name)!] : []), ...(byAlias.get(name) ?? [])]);
    const groups = [...ids].filter(isGroup);
    return groups.length === 1 ? groups[0] : undefined;
  };
  if (words.length === 2 && words[0] === 'house') return named(words[1]) ?? named(`${words[1]}s`);
  if (words.length === 1 && words[0] !== 'house') {
    return named(`house ${words[0]}`) ?? (words[0].endsWith('s') ? named(`house ${words[0].slice(0, -1)}`) : undefined);
  }
  return undefined;
}

function add<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

/** `merge`: code only, one unit for the book. */
export function mergeAiStep(): AiStep<StoryGuideSubject> {
  return {
    id: 'merge',
    version: 2,
    slot: null,
    dependsOn: ['text', 'names'],
    units: () => [{ id: 'book' }],
    fingerprint: () => hashOf('merge'),
    run: (ctx) => Promise.resolve(mergeNames(textResult(ctx).passages, namesResults(ctx))),
  };
}
