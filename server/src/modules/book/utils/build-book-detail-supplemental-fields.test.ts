import { describe, expect, it } from 'vitest';
import { buildBookDetailSupplementalFields } from './build-book-detail-supplemental-fields';

describe('buildBookDetailSupplementalFields', () => {
  it('returns null supplemental state when no personal or media state exists', () => {
    const result = buildBookDetailSupplementalFields({
      readStatus: null,
      hasAudioFiles: false,
      narratorRows: [],
      audioMeta: { durationSeconds: undefined, abridged: undefined },
      chapters: null,
      comicMeta: null,
      collections: [],
    });

    expect(result).toEqual({
      readStatus: null,
      audioMetadata: null,
      comicMetadata: null,
      collections: [],
    });
  });

  it('maps audio detail with stable narrator ordering and default abridged=false', () => {
    const result = buildBookDetailSupplementalFields({
      readStatus: {
        status: 'reading',
        source: 'manual',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      hasAudioFiles: true,
      narratorRows: [
        { id: 2, name: 'Narrator Two', sortName: 'Two, Narrator' },
        { id: 1, name: 'Narrator One', sortName: null },
      ],
      audioMeta: { durationSeconds: 5400, abridged: null },
      chapters: [{ title: 'Chapter 1', startMs: 0 }],
      comicMeta: null,
      collections: [{ id: 9, name: 'Favorites' }],
    });

    expect(result.readStatus).toEqual({
      status: 'reading',
      source: 'manual',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.audioMetadata).toEqual({
      narrators: [
        { id: 2, name: 'Narrator Two', sortName: 'Two, Narrator', displayOrder: 0 },
        { id: 1, name: 'Narrator One', sortName: null, displayOrder: 1 },
      ],
      durationSeconds: 5400,
      abridged: false,
      chapters: [{ title: 'Chapter 1', startMs: 0 }],
      chaptersSource: null,
      chaptersUpdatedAt: null,
    });
    expect(result.collections).toEqual([{ id: 9, name: 'Favorites' }]);
  });

  it('maps comic metadata and drops null fields to undefined', () => {
    const result = buildBookDetailSupplementalFields({
      readStatus: null,
      hasAudioFiles: false,
      narratorRows: [],
      audioMeta: { durationSeconds: null, abridged: false },
      chapters: null,
      comicMeta: {
        issueNumber: '7',
        volumeName: null,
        pencillers: ['Penciller'],
        inkers: null,
        colorists: ['Colorist'],
        letterers: null,
        coverArtists: ['Cover Artist'],
        characters: ['Hero'],
        teams: ['Team'],
        locations: null,
        storyArcs: ['Arc'],
      },
      collections: [],
    });

    expect(result.comicMetadata).toEqual({
      issueNumber: '7',
      volumeName: undefined,
      pencillers: ['Penciller'],
      inkers: undefined,
      colorists: ['Colorist'],
      letterers: undefined,
      coverArtists: ['Cover Artist'],
      characters: ['Hero'],
      teams: ['Team'],
      locations: undefined,
      storyArcs: ['Arc'],
    });
  });
});
