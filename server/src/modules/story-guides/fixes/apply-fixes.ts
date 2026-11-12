import {
  STORY_GUIDE_ENTITY_KINDS,
  storyGuideTieType,
  type StoryGuideAnchor,
  type StoryGuideEntity,
  type StoryGuideEntityKind,
  type StoryGuideFixPosition,
  type StoryGuideFixTarget,
  type StoryGuideJoin,
  type StoryGuideLine,
  type StoryGuidePayloadV1,
  type StoryGuideTie,
} from '@bookorbit/types';

import { storyGuideKey } from '../pipeline/assemble-step';

/** A stored fix, as applying reads it. */
export interface StoryGuideFixInput {
  id: string;
  kind: string;
  target: StoryGuideFixTarget;
  data: Record<string, unknown>;
  from: StoryGuideFixPosition | null;
}

/** How a fix fared against one guide: applied to the key it found, by key or by former names, or orphaned. */
export type StoryGuideFixOutcome = { applied: true; key: string; via: 'key' | 'names' } | { applied: false };

export interface AppliedStoryGuideFixes {
  payload: StoryGuidePayloadV1;
  outcomes: Map<string, StoryGuideFixOutcome>;
}

const TERM_KINDS: ReadonlySet<StoryGuideEntityKind> = new Set(['event', 'object', 'idea']);
const ENTITY_KINDS: ReadonlySet<string> = new Set(STORY_GUIDE_ENTITY_KINDS);

/** Earlier anchors first; an end anchor comes after every offset in its section. */
export function compareAnchors(a: StoryGuideAnchor, b: StoryGuideAnchor): number {
  if (a.s !== b.s) return a.s - b.s;
  const at = (anchor: StoryGuideAnchor) => ('end' in anchor ? Number.POSITIVE_INFINITY : anchor.o);
  const diff = at(a) - at(b);
  return Number.isNaN(diff) ? 0 : diff;
}

function sameAnchor(a: StoryGuideAnchor, b: StoryGuideAnchor): boolean {
  if (a.s !== b.s) return false;
  if ('end' in a || 'end' in b) return 'end' in a && 'end' in b;
  return a.o === b.o;
}

function later(a: StoryGuideAnchor, b: StoryGuideAnchor): StoryGuideAnchor {
  return compareAnchors(a, b) >= 0 ? a : b;
}

/** An entity or a join, which has a key, names and lines of its own. */
type Entry = StoryGuideEntity | StoryGuideJoin;

interface Located {
  /** The shown entity: the entry itself, or the entity the entry joins. */
  entity: StoryGuideEntity;
  join: StoryGuideJoin | null;
}

function entryOf(located: Located): Entry {
  return located.join ?? located.entity;
}

function firstAnchor(entry: Entry): StoryGuideAnchor | null {
  let first: StoryGuideAnchor | null = null;
  for (const name of entry.names) if (!first || compareAnchors(name.at, first) < 0) first = name.at;
  return first;
}

function foldedNames(entry: Entry): Set<string> {
  return new Set([entry.name, ...entry.names.map((name) => name.text)].map(storyGuideKey));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
}

function asTarget(value: unknown): StoryGuideFixTarget | null {
  if (!value || typeof value !== 'object') return null;
  const { key, names } = value as Record<string, unknown>;
  return typeof key === 'string' ? { key, names: asNames(names) } : null;
}

export function asAnchor(value: unknown): StoryGuideAnchor | null {
  if (!value || typeof value !== 'object') return null;
  const { s, o, q, end } = value as Record<string, unknown>;
  if (!Number.isInteger(s) || (s as number) < 0) return null;
  if (end === true) return { s: s as number, end: true };
  if (Number.isInteger(o) && (o as number) >= 0 && typeof q === 'string') return { s: s as number, o: o as number, q };
  return null;
}

/** `a|type|b`, with the type in the middle; keys hold no `|`. */
function tieSides(key: string): { a: string; type: string; b: string } | null {
  const parts = key.split('|');
  return parts.length === 3 && parts.every(Boolean) ? { a: parts[0], type: parts[1], b: parts[2] } : null;
}

/**
 * A guide being fixed, one fix at a time in the order they were made, so a fix can target what an
 * earlier one made: a join a merge created, the entry a split moved out.
 */
class FixedGuide {
  private readonly sections: number[];

  constructor(readonly payload: StoryGuidePayloadV1) {
    this.sections = payload.sections.map((section) => section.s).sort((a, b) => a - b);
  }

  private get entities(): StoryGuideEntity[] {
    return this.payload.entities;
  }

  private get ties(): StoryGuideTie[] {
    return this.payload.ties;
  }

  /**
   * By key first, then by the target's former names when exactly one entry holds most of them and
   * at least `minNames` of them. A fix that removes something asks for more than one, so a name
   * two entries once shared cannot hide the wrong one.
   */
  locate(target: StoryGuideFixTarget, minNames = 1): (Located & { via: 'key' | 'names' }) | null {
    for (const entity of this.entities) {
      if (entity.key === target.key) return { entity, join: null, via: 'key' };
      const join = entity.joins.find((candidate) => candidate.key === target.key);
      if (join) return { entity, join, via: 'key' };
    }
    const wanted = new Set(target.names.map(storyGuideKey));
    if (wanted.size < minNames || wanted.size === 0) return null;
    let best: Located | null = null;
    let bestScore = 0;
    let tied = false;
    for (const entity of this.entities) {
      for (const located of [{ entity, join: null }, ...entity.joins.map((join) => ({ entity, join }))] as Located[]) {
        let score = 0;
        for (const name of foldedNames(entryOf(located))) if (wanted.has(name)) score++;
        if (score === 0 || score < bestScore) continue;
        if (score === bestScore) {
          tied = true;
          continue;
        }
        best = located;
        bestScore = score;
        tied = false;
      }
    }
    return best && !tied && bestScore >= minNames ? { ...best, via: 'names' } : null;
  }

  /** By key first, then by its type between the entries its sides' keys or former names find now. */
  locateTie(key: string, aNames: string[], bNames: string[]): { tie: StoryGuideTie; via: 'key' | 'names' } | null {
    const exact = this.ties.find((tie) => tie.key === key);
    if (exact) return { tie: exact, via: 'key' };
    const sides = tieSides(key);
    if (!sides) return null;
    const a = this.locate({ key: sides.a, names: aNames });
    const b = this.locate({ key: sides.b, names: bNames });
    if (!a || !b) return null;
    const keys = this.tieKey(entryOf(a).key, sides.type, entryOf(b).key);
    const tie = this.ties.find((candidate) => candidate.key === keys.key);
    return tie ? { tie, via: 'names' } : null;
  }

  /**
   * Where text a fix adds shows from: the start of the section `from` names, which is the end of
   * the story section before it, and never before `floor`, the first place the entry is named.
   */
  startAt(from: StoryGuideFixPosition | null, floor: StoryGuideAnchor): StoryGuideAnchor {
    if (!from) return floor;
    let previous: number | null = null;
    for (const s of this.sections) {
      if (s >= from.s) break;
      previous = s;
    }
    if (previous === null) return floor;
    const start: StoryGuideAnchor = { s: previous, end: true };
    return compareAnchors(start, floor) < 0 ? floor : start;
  }

  tieKey(a: string, type: string, b: string): { key: string; a: string; b: string } {
    const symmetric = storyGuideTieType(type)?.symmetric ?? false;
    const [first, second] = symmetric && b < a ? [b, a] : [a, b];
    return { key: `${first}|${type}|${second}`, a: first, b: second };
  }

  removeTiesNaming(keys: ReadonlySet<string>): void {
    this.payload.ties = this.ties.filter((tie) => !keys.has(tie.a) && !keys.has(tie.b));
  }

  removeTie(tie: StoryGuideTie): void {
    this.payload.ties = this.ties.filter((candidate) => candidate !== tie);
  }

  addTie(tie: StoryGuideTie): void {
    this.ties.push(tie);
  }

  removeEntity(entity: StoryGuideEntity): void {
    this.payload.entities = this.entities.filter((candidate) => candidate !== entity);
  }

  /** Placed by where it is first named, as the build orders entities. */
  insertEntity(entity: StoryGuideEntity): void {
    const first = firstAnchor(entity);
    const index = first ? this.entities.findIndex((other) => compareAnchors(firstAnchor(other) ?? first, first) > 0) : -1;
    if (index < 0) this.entities.push(entity);
    else this.entities.splice(index, 0, entity);
  }

  /** The name's key, with `-2`, `-3` when an entry already has it. */
  freshKey(name: string): string {
    const taken = new Set<string>();
    for (const entity of this.entities) {
      taken.add(entity.key);
      for (const join of entity.joins) taken.add(join.key);
    }
    const base = storyGuideKey(name);
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
    return key;
  }
}

function keysOf(entity: StoryGuideEntity): Set<string> {
  return new Set([entity.key, ...entity.joins.map((join) => join.key)]);
}

function setAt(list: StoryGuideLine[], through: StoryGuideAnchor, text: string): void {
  const existing = list.find((line) => sameAnchor(line.through, through));
  if (existing) {
    existing.text = text;
    return;
  }
  const line: StoryGuideLine = { through, text };
  const index = list.findIndex((other) => compareAnchors(other.through, through) > 0);
  if (index < 0) list.push(line);
  else list.splice(index, 0, line);
}

/** A description fix writes the line, and the profile at the same end when the guide has profiles, so the entry page shows it too. */
function setLine(entry: Entry, through: StoryGuideAnchor, text: string): void {
  setAt(entry.lines, through, text);
  if (entry.profiles) setAt(entry.profiles, through, text);
}

type Applied = { key: string; via: 'key' | 'names' } | null;

/** Former names that must agree before a hide follows an entry whose key is gone; otherwise the hide is orphaned. */
const HIDE_MIN_NAMES = 2;

function isPayloadV1(payload: unknown): payload is StoryGuidePayloadV1 {
  if (!payload || typeof payload !== 'object') return false;
  const { sections, entities, ties } = payload as Record<string, unknown>;
  return Array.isArray(sections) && Array.isArray(entities) && Array.isArray(ties);
}

function applyOne(guide: FixedGuide, fix: StoryGuideFixInput): Applied {
  const data = fix.data;
  switch (fix.kind) {
    case 'hide': {
      const found = guide.locate(fix.target, HIDE_MIN_NAMES);
      if (!found) return null;
      if (found.join) {
        found.entity.joins = found.entity.joins.filter((join) => join !== found.join);
        found.entity.fixed = true;
        guide.removeTiesNaming(new Set([found.join.key]));
      } else {
        guide.removeEntity(found.entity);
        guide.removeTiesNaming(keysOf(found.entity));
      }
      return { key: entryOf(found).key, via: found.via };
    }
    case 'rename': {
      const name = asString(data.name);
      const found = guide.locate(fix.target);
      if (!name || !found) return null;
      const entry = entryOf(found);
      const folded = storyGuideKey(name);
      if (!entry.names.some((own) => storyGuideKey(own.text) === folded)) {
        const floor = firstAnchor(entry);
        if (!floor) return null;
        entry.names.push({ text: name, at: guide.startAt(fix.from, floor) });
      }
      entry.name = name;
      found.entity.fixed = true;
      return { key: entry.key, via: found.via };
    }
    case 'kind':
    case 'guide-kind': {
      const wanted = asString(data.kind);
      const found = guide.locate(fix.target);
      if (!wanted || !found) return null;
      const entity = found.entity;
      let kind: StoryGuideEntityKind;
      if (fix.kind === 'guide-kind') {
        if (!ENTITY_KINDS.has(wanted)) return null;
        kind = wanted as StoryGuideEntityKind;
      } else if (wanted === 'person') kind = 'character';
      else if (wanted === 'place') kind = 'place';
      else if (wanted === 'term') kind = TERM_KINDS.has(entity.kind) ? entity.kind : 'idea';
      else return null;
      entity.kind = kind;
      entity.fixed = true;
      return { key: entryOf(found).key, via: found.via };
    }
    case 'merge': {
      const into = asTarget(data.into);
      const source = guide.locate(fix.target);
      const destination = into ? guide.locate(into) : null;
      if (!source || !destination) return null;
      const result = { key: entryOf(source).key, via: source.via };
      const kept = destination.entity;
      if (source.entity === kept) return result;
      const entry = entryOf(source);
      const floor = firstAnchor(entry);
      if (!floor) return null;
      const joins: StoryGuideJoin[] = [
        { key: entry.key, name: entry.name, names: entry.names, lines: entry.lines, profiles: entry.profiles, at: guide.startAt(fix.from, floor) },
      ];
      if (source.join) {
        source.entity.joins = source.entity.joins.filter((join) => join !== source.join);
        source.entity.fixed = true;
      } else {
        joins.push(...source.entity.joins);
        guide.removeEntity(source.entity);
      }
      kept.joins = [...kept.joins, ...joins].sort((a, b) => compareAnchors(a.at, b.at));
      kept.fixed = true;
      // A tie between two entries of one entity is the entity itself.
      const merged = keysOf(kept);
      guide.payload.ties = guide.payload.ties.filter((tie) => !(merged.has(tie.a) && merged.has(tie.b)));
      return result;
    }
    case 'split': {
      const name = asString(data.name);
      const found = guide.locate(fix.target);
      if (!name || !found) return null;
      const entity = found.entity;
      const folded = storyGuideKey(name);
      const join = entity.joins.find((candidate) => foldedNames(candidate).has(folded));
      if (join) {
        entity.joins = entity.joins.filter((candidate) => candidate !== join);
        entity.fixed = true;
        guide.insertEntity({
          key: join.key,
          name: join.name,
          kind: entity.kind,
          names: join.names,
          joins: [],
          lines: join.lines,
          profiles: join.profiles,
          fixed: true,
        });
        return { key: entryOf(found).key, via: found.via };
      }
      const index = entity.names.findIndex((own) => storyGuideKey(own.text) === folded);
      if (index < 0 || entity.names.length < 2) return null;
      const [moved] = entity.names.splice(index, 1);
      if (storyGuideKey(entity.name) === folded) entity.name = entity.names[0].text;
      entity.fixed = true;
      guide.insertEntity({ key: guide.freshKey(moved.text), name: moved.text, kind: entity.kind, names: [moved], joins: [], lines: [], fixed: true });
      return { key: entryOf(found).key, via: found.via };
    }
    case 'line': {
      const text = asString(data.text);
      const found = guide.locate(fix.target);
      if (!text || !found) return null;
      const entry = entryOf(found);
      const floor = firstAnchor(entry);
      if (!floor) return null;
      const replaces = asAnchor(data.through);
      if (replaces) setLine(entry, entry.lines.some((line) => sameAnchor(line.through, replaces)) ? replaces : later(replaces, floor), text);
      else if (fix.from) setLine(entry, guide.startAt(fix.from, floor), text);
      else return null;
      found.entity.fixed = true;
      return { key: entry.key, via: found.via };
    }
    case 'line-hide': {
      const through = asAnchor(data.through);
      const found = guide.locate(fix.target);
      if (!through || !found) return null;
      const entry = entryOf(found);
      const before = entry.lines.length;
      entry.lines = entry.lines.filter((line) => !sameAnchor(line.through, through));
      if (entry.lines.length === before) return null;
      // The profile written at the same end goes with it, or the entry page would still show what was hidden.
      if (entry.profiles) entry.profiles = entry.profiles.filter((profile) => !sameAnchor(profile.through, through));
      found.entity.fixed = true;
      return { key: entry.key, via: found.via };
    }
    case 'tie-hide':
    case 'tie-type': {
      const found = guide.locateTie(fix.target.key, asNames(data.a), asNames(data.b));
      if (!found) return null;
      const result = { key: found.tie.key, via: found.via };
      if (fix.kind === 'tie-hide') {
        guide.removeTie(found.tie);
        return result;
      }
      const type = asString(data.type);
      const info = type ? storyGuideTieType(type) : undefined;
      if (!type || !info) return null;
      const next = guide.tieKey(found.tie.a, type, found.tie.b);
      const other = guide.payload.ties.find((tie) => tie.key === next.key && tie !== found.tie);
      if (other) {
        guide.removeTie(found.tie);
        other.fixed = true;
        return result;
      }
      Object.assign(found.tie, { key: next.key, a: next.a, b: next.b, type, label: info.label, fixed: true });
      return result;
    }
    case 'tie-add': {
      const type = asString(data.type);
      const info = type ? storyGuideTieType(type) : undefined;
      const other = asTarget(data.b);
      const a = guide.locate(fix.target);
      const b = other ? guide.locate(other) : null;
      if (!type || !info || !a || !b || a.entity === b.entity) return null;
      const next = guide.tieKey(entryOf(a).key, type, entryOf(b).key);
      const existing = guide.payload.ties.find((tie) => tie.key === next.key);
      if (existing) {
        existing.fixed = true;
        return { key: entryOf(a).key, via: a.via };
      }
      const floorA = firstAnchor(entryOf(a));
      const floorB = firstAnchor(entryOf(b));
      if (!floorA || !floorB) return null;
      guide.addTie({
        key: next.key,
        a: next.a,
        type,
        b: next.b,
        label: info.label,
        at: guide.startAt(fix.from, later(floorA, floorB)),
        quotes: [],
        count: 0,
        fixed: true,
      });
      return { key: entryOf(a).key, via: a.via };
    }
    default:
      return null;
  }
}

/**
 * Applies fixes to a format 1 payload, in the given order, without changing the input. A fix
 * whose target is not found, or whose change no longer applies (a split name the entry lost, a
 * line that is gone), is orphaned and changes nothing.
 */
export function applyStoryGuideFixes(payload: StoryGuidePayloadV1, fixes: readonly StoryGuideFixInput[]): AppliedStoryGuideFixes {
  const outcomes = new Map<string, StoryGuideFixOutcome>();
  if (!isPayloadV1(payload)) {
    for (const fix of fixes) outcomes.set(fix.id, { applied: false });
    return { payload, outcomes };
  }
  const guide = new FixedGuide(structuredClone(payload));
  for (const fix of fixes) {
    const applied = applyOne(guide, fix);
    outcomes.set(fix.id, applied ? { applied: true, ...applied } : { applied: false });
  }
  return { payload: guide.payload, outcomes };
}
