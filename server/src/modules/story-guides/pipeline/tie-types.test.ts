import { readFileSync } from 'fs';
import { join } from 'path';

import { STORY_GUIDE_ENTITY_KINDS, STORY_GUIDE_TIE_GROUPS, STORY_GUIDE_TIE_TYPES, storyGuideTieType } from '@bookorbit/types';

import { FIXTURES_DIR } from '../testing/story-guide-fixtures';

describe('the tie registry', () => {
  it('matches the shared fixture the app decodes', () => {
    const fixture: unknown = JSON.parse(readFileSync(join(FIXTURES_DIR, 'tie-types.json'), 'utf8'));
    expect(fixture).toEqual({ kinds: STORY_GUIDE_ENTITY_KINDS, groups: STORY_GUIDE_TIE_GROUPS, types: STORY_GUIDE_TIE_TYPES });
  });

  it('has a known group and kind for every type, and every type once', () => {
    const groups = new Set(STORY_GUIDE_TIE_GROUPS.map((group) => group.group));
    const kinds = new Set<string>(STORY_GUIDE_ENTITY_KINDS);
    expect(new Set(STORY_GUIDE_TIE_TYPES.map((type) => type.type)).size).toBe(STORY_GUIDE_TIE_TYPES.length);
    for (const type of STORY_GUIDE_TIE_TYPES) {
      expect(groups.has(type.group)).toBe(true);
      expect([...type.from, ...type.to].every((kind) => kinds.has(kind))).toBe(true);
      expect(storyGuideTieType(type.type)).toBe(type);
    }
    expect(storyGuideTieType('neighbour_of')).toBeUndefined();
  });
});
