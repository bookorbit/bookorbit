import { MetadataProviderKey } from '@projectx/types';

import { mapIssueToCandidate } from './comicvine.mapper';
import type { ComicVineIssue } from './comicvine.types';

function makeIssue(overrides: Partial<ComicVineIssue> = {}): ComicVineIssue {
  return {
    id: 100,
    name: 'Issue Name',
    issue_number: '1',
    cover_date: '2024-05-01',
    store_date: null,
    description: 'Issue description',
    deck: null,
    image: { original_url: 'https://example.com/cover.jpg' },
    volume: { id: 10, name: 'Series Name' },
    site_detail_url: 'https://comicvine.gamespot.com/issue',
    person_credits: [],
    character_credits: [],
    team_credits: [],
    story_arc_credits: [],
    location_credits: [],
    ...overrides,
  };
}

describe('mapIssueToCandidate', () => {
  it('maps rich issue metadata including role-based contributor fields', () => {
    const candidate = mapIssueToCandidate(
      makeIssue({
        id: 777,
        name: 'The Origin',
        issue_number: '12.5',
        description: null,
        deck: 'Fallback synopsis',
        person_credits: [
          { id: 1, name: 'Writer A', role: 'writer' },
          { id: 2, name: 'Artist A', role: 'penciller' },
          { id: 3, name: 'Artist B', role: 'artist, inker' },
          { id: 4, name: 'Colorist A', role: 'Colorist, Cover Artist' },
          { id: 5, name: 'Letterer A', role: 'letterer' },
        ],
        character_credits: [{ id: 21, name: 'Character A' }],
        team_credits: [{ id: 31, name: 'Team A' }],
        location_credits: [{ id: 41, name: 'Location A' }],
        story_arc_credits: [{ id: 51, name: 'Arc A' }],
      }),
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        provider: MetadataProviderKey.COMICVINE,
        providerId: '777',
        title: 'Series Name #12.5 - The Origin',
        subtitle: 'The Origin',
        authors: ['Writer A'],
        description: 'Fallback synopsis',
        publishedYear: 2024,
        seriesName: 'Series Name',
        seriesIndex: 12.5,
        coverUrl: 'https://example.com/cover.jpg',
        sourceUrl: 'https://comicvine.gamespot.com/issue',
      }),
    );
    expect(candidate.comicMetadata).toEqual(
      expect.objectContaining({
        issueNumber: '12.5',
        volumeName: 'Series Name',
        pencillers: ['Artist A', 'Artist B'],
        inkers: ['Artist B'],
        colorists: ['Colorist A'],
        letterers: ['Letterer A'],
        coverArtists: ['Colorist A'],
        characters: ['Character A'],
        teams: ['Team A'],
        locations: ['Location A'],
        storyArcs: ['Arc A'],
      }),
    );
  });

  it('uses store_date fallback and treats malformed years as unknown', () => {
    const fromStoreDate = mapIssueToCandidate(
      makeIssue({
        cover_date: null,
        store_date: '2019-11-03',
      }),
    );
    expect(fromStoreDate.publishedYear).toBe(2019);

    const malformedYear = mapIssueToCandidate(
      makeIssue({
        name: null,
        issue_number: '7',
        cover_date: '20XX-04-03',
        store_date: null,
      }),
    );
    expect(malformedYear.title).toBe('Series Name #7');
    expect(malformedYear.publishedYear).toBeUndefined();
  });

  it('keeps optional fields undefined when source values are not usable', () => {
    const candidate = mapIssueToCandidate(
      makeIssue({
        issue_number: 'Annual Special',
        image: null,
        site_detail_url: null,
      }),
    );

    expect(candidate.seriesIndex).toBeUndefined();
    expect(candidate.coverUrl).toBeUndefined();
    expect(candidate.sourceUrl).toBeUndefined();
  });
});
