import { AiUnitSkipped } from './ai-feature';
import { AI_JOBS_SPLIT_FLOOR_CHARS } from './ai-jobs.constants';
import { aiErrorCode } from './ai-jobs.ports';

/**
 * Runs `attempt` on the text. When the client answers `too-long` (the reply was cut short even with
 * more room), splits the text in two at the whitespace nearest its middle and runs each half, down to
 * `floor` characters. A part that is still too long at the floor leaves the unit out as `too-long`.
 * Results come back in text order. Any other error is passed on unchanged.
 */
export async function splitWhileTooLong<T>(
  text: string,
  attempt: (part: string) => Promise<T>,
  floor: number = AI_JOBS_SPLIT_FLOOR_CHARS,
): Promise<T[]> {
  try {
    return [await attempt(text)];
  } catch (error) {
    if (aiErrorCode(error) !== 'too-long') throw error;
    if (text.length <= floor) throw new AiUnitSkipped('too-long');
    const [left, right] = halve(text);
    return [...(await splitWhileTooLong(left, attempt, floor)), ...(await splitWhileTooLong(right, attempt, floor))];
  }
}

/** Two halves split at the whitespace nearest the middle, or at the middle when there is none. */
export function halve(text: string): [string, string] {
  const middle = Math.floor(text.length / 2);
  for (let offset = 0; offset < middle; offset++) {
    for (const at of [middle - offset, middle + offset]) {
      if (at > 0 && at < text.length && /\s/.test(text[at]!)) return [text.slice(0, at).trimEnd(), text.slice(at).trimStart()];
    }
  }
  return [text.slice(0, middle), text.slice(middle)];
}
