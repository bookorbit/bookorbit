import { labRun, publicDomainText, type LabRun } from '../testing/story-guide-fixtures';
import { parseJsonReply } from './json-reply';
import { mergeNames } from './merge-step';
import { locateName } from './name-text';
import { entryKind } from './names-step';
import { applyReview, readReviewAnswer, reviewGroups } from './review-step';
import type { PassageSpan, StoryMergeResult, StoryNamesResult, StoryReviewResult } from './story-guide.types';
import type { StoryPassage, TextStepResult } from './text-step';

/**
 * The saved public-domain run replayed through the server's steps, with no model calls: the lab's
 * kept entries as each passage's names, merged, and its saved review reply applied. The lab's units
 * and the server's passages match one for one in order; their text differs (the lab's keeps
 * Gutenberg's hard line wraps), so lab items are matched by unit order and by name, never by offset.
 */
export interface LabReplay {
  lab: LabRun;
  text: TextStepResult;
  /** The server passage for a lab unit number (1-based). */
  passageOf(unit: number): StoryPassage;
  names: Map<string, StoryNamesResult>;
  /** Lab names the server's text of their passage does not hold as written. */
  unlocated: string[];
  merge: StoryMergeResult;
  review: StoryReviewResult;
}

let cached: Promise<LabReplay> | null = null;

export function labReplay(): Promise<LabReplay> {
  cached ??= (async () => {
    const lab = labRun();
    const { text } = await publicDomainText();
    const passageOf = (unit: number) => text.passages[unit - 1];
    const unlocated: string[] = [];
    const names = new Map<string, StoryNamesResult>();
    for (const saved of Object.values(lab.names).sort((a, b) => a.unit - b.unit)) {
      const passage = passageOf(saved.unit);
      names.set(passage.id, {
        passage: passage.id,
        chapter: passage.chapter,
        part: passage.part,
        narrator: saved.narrator,
        entries: saved.entries.map((entry) => {
          const at: Record<string, PassageSpan> = {};
          for (const name of [entry.name, ...entry.aliases]) {
            const found = locateName(passage.text, name);
            if (!found) unlocated.push(`${passage.id} ${name}`);
            at[name] = found ? { passage: passage.id, ...found } : { passage: passage.id, offset: 0, text: name };
          }
          return { name: entry.name, aliases: entry.aliases, kind: entryKind(entry.kind), what: entry.what, at };
        }),
      });
    }
    const merge = mergeNames(text.passages, names);
    const answered = readReviewAnswer(parseJsonReply(lab.review.raw) ?? {}) ?? [];
    const review = applyReview(reviewGroups(answered, merge, text), merge, text);
    return { lab, text, passageOf, names, unlocated, merge, review };
  })();
  return cached;
}
