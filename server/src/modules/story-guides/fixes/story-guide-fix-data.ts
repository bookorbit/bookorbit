import {
  STORY_GUIDE_ENTITY_KINDS,
  STORY_GUIDE_FIX_DATA_MAX_BYTES,
  STORY_GUIDE_FIX_KEY_MAX_LENGTH,
  STORY_GUIDE_FIX_NAME_MAX_LENGTH,
  STORY_GUIDE_FIX_NAMES_MAX,
  STORY_GUIDE_FIX_TABS,
  STORY_GUIDE_FIX_TEXT_MAX_LENGTH,
  STORY_GUIDE_TIE_FIX_KINDS,
  storyGuideTieType,
  type StoryGuideFixKind,
} from '@bookorbit/types';

import { isJsonbStorable, isPlainJsonObject } from '../../../common/utils/jsonb-value.utils';

/** The longest quote an anchor in a fix may carry; the payload's are at most 12 words. */
const ANCHOR_QUOTE_MAX_LENGTH = 500;

/** A tie's key: two entry keys and a type between them. */
export const STORY_GUIDE_TIE_KEY_PATTERN = /^[^|]+\|[a-z][a-z_]*\|[^|]+$/;

function textProblem(value: unknown, field: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return `data.${field} must be a non-empty string`;
  if (value.trim().length > STORY_GUIDE_FIX_TEXT_MAX_LENGTH) return `data.${field} must be at most ${STORY_GUIDE_FIX_TEXT_MAX_LENGTH} characters`;
  return null;
}

function namesProblem(value: unknown, field: string): string | null {
  if (!Array.isArray(value) || value.length > STORY_GUIDE_FIX_NAMES_MAX)
    return `${field} must be a list of at most ${STORY_GUIDE_FIX_NAMES_MAX} names`;
  if (!value.every((name) => typeof name === 'string' && name.length >= 1 && name.length <= STORY_GUIDE_FIX_NAME_MAX_LENGTH)) {
    return `${field} must hold names of 1 to ${STORY_GUIDE_FIX_NAME_MAX_LENGTH} characters`;
  }
  return null;
}

function targetProblem(value: unknown, field: string): string | null {
  if (!isPlainJsonObject(value)) return `${field} must be an object with key and names`;
  const { key, names } = value;
  if (typeof key !== 'string' || key.length < 1 || key.length > STORY_GUIDE_FIX_KEY_MAX_LENGTH) {
    return `${field}.key must be 1 to ${STORY_GUIDE_FIX_KEY_MAX_LENGTH} characters`;
  }
  return namesProblem(names, `${field}.names`);
}

function anchorProblem(value: unknown, field: string): string | null {
  const problem = `${field} must be an anchor, { s, end: true } or { s, o, q }`;
  if (!isPlainJsonObject(value)) return problem;
  const { s, o, q, end } = value;
  if (!Number.isInteger(s) || (s as number) < 0) return problem;
  if (end === true) return null;
  if (!Number.isInteger(o) || (o as number) < 0 || typeof q !== 'string' || q.length > ANCHOR_QUOTE_MAX_LENGTH) return problem;
  return null;
}

function tieTypeProblem(value: unknown): string | null {
  return typeof value === 'string' && storyGuideTieType(value) ? null : 'data.type must be a tie type this server knows';
}

function sidesProblem(data: Record<string, unknown>): string | null {
  for (const side of ['a', 'b'] as const) {
    if (data[side] === undefined) continue;
    const problem = namesProblem(data[side], `data.${side}`);
    if (problem) return problem;
  }
  return null;
}

/**
 * Why a fix cannot be stored, or null when it can. `data` is checked for what applying the kind
 * reads, and keys it does not read pass. A delete is checked for its size only.
 */
export function storyGuideFixProblem(fix: { kind: string; targetKey?: unknown; data: unknown; hasFrom: boolean; deleted: boolean }): string | null {
  const { data } = fix;
  if (!isPlainJsonObject(data)) return 'data must be a JSON object';
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > STORY_GUIDE_FIX_DATA_MAX_BYTES) {
    return `data must serialise to at most ${STORY_GUIDE_FIX_DATA_MAX_BYTES} bytes`;
  }
  if (!isJsonbStorable(data)) return 'data must not contain NUL characters or unpaired surrogates';
  if (fix.deleted) return null;

  const kind = fix.kind as StoryGuideFixKind;
  if (STORY_GUIDE_TIE_FIX_KINDS.includes(kind) && !(typeof fix.targetKey === 'string' && STORY_GUIDE_TIE_KEY_PATTERN.test(fix.targetKey))) {
    return 'target.key must be a tie key, a|type|b';
  }
  switch (kind) {
    case 'rename':
    case 'split':
      return textProblem(data.name, 'name');
    case 'kind':
      return (STORY_GUIDE_FIX_TABS as readonly unknown[]).includes(data.kind) ? null : `data.kind must be one of ${STORY_GUIDE_FIX_TABS.join(', ')}`;
    case 'guide-kind':
      return (STORY_GUIDE_ENTITY_KINDS as readonly unknown[]).includes(data.kind)
        ? null
        : `data.kind must be one of ${STORY_GUIDE_ENTITY_KINDS.join(', ')}`;
    case 'merge':
      return targetProblem(data.into, 'data.into');
    case 'hide':
      return null;
    case 'line': {
      const problem = textProblem(data.text, 'text');
      if (problem) return problem;
      if (data.through !== undefined) return anchorProblem(data.through, 'data.through');
      return fix.hasFrom ? null : 'a line needs data.through, the line it replaces, or from, where it starts';
    }
    case 'line-hide':
      return anchorProblem(data.through, 'data.through');
    case 'tie-hide':
      return sidesProblem(data);
    case 'tie-type':
      return tieTypeProblem(data.type) ?? sidesProblem(data);
    case 'tie-add':
      return tieTypeProblem(data.type) ?? targetProblem(data.b, 'data.b');
    default:
      return 'kind is not a fix kind this server knows';
  }
}
