import { AiUnitSkipped, type AiStepContext, type AiStepRequest } from '../../ai-jobs/ai-feature';

/** The first JSON object in a reply, from its first `{` to the brace that closes it; null when that does not parse. */
export function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const end = closingBrace(text, start);
  if (end < 0) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The reply's JSON object. A reply with a trailing comma ("[9,]") is read without it: a review once
 * answered that way and lost every join.
 */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  return firstJsonObject(text) ?? firstJsonObject(text.replace(/,\s*([\]}])/g, '$1'));
}

/**
 * Sends the request and reads the reply with `read`, which returns null for an answer it cannot use.
 * Such an answer is asked for once more; a second one leaves the unit out as `invalid-json`.
 */
export async function askForJson<T>(
  ctx: Pick<AiStepContext, 'complete'>,
  request: AiStepRequest,
  read: (answer: Record<string, unknown>) => T | null,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await ctx.complete(request);
    const answer = parseJsonReply(reply.text);
    const value = answer ? read(answer) : null;
    if (value !== null) return value;
  }
  throw new AiUnitSkipped('invalid-json');
}

function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}
