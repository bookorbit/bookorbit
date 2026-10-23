import { isAudioFormat } from '@bookorbit/types';

import { compareAudioTracks, planAudioTrackOrderRepair, resolveIsAudiobook } from './book-media.utils';

describe('resolveIsAudiobook', () => {
  it('uses the primary file when the book has files', () => {
    expect(resolveIsAudiobook([{ format: 'm4b', role: 'primary' }], null)).toBe(true);
    expect(resolveIsAudiobook([{ format: 'epub', role: 'primary' }], null)).toBe(false);
  });

  it('follows the primary file for a book that holds both editions', () => {
    const files = [
      { format: 'epub', role: 'primary' },
      { format: 'm4b', role: 'content' },
    ];

    expect(resolveIsAudiobook(files, null)).toBe(false);
  });

  it('leads with the file the library ranked first, not the one that sorts first by path', () => {
    const files = [
      { id: 1, format: 'epub', role: 'content' },
      { id: 2, format: 'm4b', role: 'content' },
    ];
    expect(resolveIsAudiobook(files, null, 2)).toBe(true);
    expect(resolveIsAudiobook(files, null, 1)).toBe(false);
    expect(resolveIsAudiobook(files, null, null)).toBe(false);
  });

  it('ignores stale audiobook identifiers on an ebook', () => {
    expect(resolveIsAudiobook([{ format: 'epub', role: 'primary' }], { audibleId: 'B0ABC12345', durationSeconds: 3600 })).toBe(false);
  });

  it('falls back to audio metadata when no file states a format', () => {
    expect(resolveIsAudiobook([{ format: null, role: 'content' }], { durationSeconds: 3600 })).toBe(true);
    expect(resolveIsAudiobook([], { librofmId: '9781234567890' })).toBe(true);
    expect(resolveIsAudiobook(undefined, { audibleId: 'B0ABC12345' })).toBe(true);
    expect(resolveIsAudiobook(undefined, null)).toBe(false);
  });
});

describe('planAudioTrackOrderRepair', () => {
  type Row = { id: number; absolutePath: string; format: string | null; sortOrder: number | null };

  const track = (id: number, name: string, sortOrder: number | null, format: string | null = 'mp3'): Row => ({
    id,
    absolutePath: `/library/Andy Weir/Project Hail Mary (2021)/${name}`,
    format,
    sortOrder,
  });

  /** Plays the rows the way the audiobook manifest does once the plan is applied. */
  function playbackAfter(rows: Row[]): string[] {
    const updates = new Map(planAudioTrackOrderRepair(rows).map((update) => [update.id, update.sortOrder]));
    return rows
      .map((row) => ({ ...row, sortOrder: updates.get(row.id) ?? row.sortOrder }))
      .filter((row) => row.format !== null && isAudioFormat(row.format))
      .sort(compareAudioTracks)
      .map((row) => row.absolutePath.split('/').pop()!);
  }

  it('leaves a book alone when its tracks already play in path order', () => {
    const rows = [track(1, 'cover.jpg', 0, 'jpg'), track(2, 'Part 1.mp3', 1), track(3, 'Part 2.mp3', 2), track(4, 'Part 10.mp3', 3)];

    expect(planAudioTrackOrderRepair(rows)).toEqual([]);
  });

  it('leaves gaps in the numbering alone, since only the order matters', () => {
    const rows = [track(1, 'Part 1.mp3', 0), track(2, 'Part 2.mp3', 7), track(3, 'Part 3.mp3', 40)];

    expect(planAudioTrackOrderRepair(rows)).toEqual([]);
  });

  it('ignores books with fewer than two tracks', () => {
    expect(planAudioTrackOrderRepair([])).toEqual([]);
    expect(planAudioTrackOrderRepair([track(1, 'book.m4b', null, 'm4b'), track(2, 'book.epub', 5, 'epub')])).toEqual([]);
  });

  it('repairs the order reported in issue 1681, where two scans numbered the folder from different listings', () => {
    const extras = ['author.jpg', 'back.jpg', 'cover.jpg', 'description.txt', 'folder.jpg', 'info.txt', 'narrator.txt'];
    const rows: Row[] = extras.map((name, index) => track(100 + index, name, index, name.endsWith('.jpg') ? 'jpg' : 'txt'));
    // A scan of the whole folder numbered 01 and 02 after the seven extras; one that listed the
    // folder before 01, 02 and the extras arrived finished last and numbered 03 to 32 from zero.
    rows.push(track(1, 'Project Hail Mary (01).mp3', 7), track(2, 'Project Hail Mary (02).mp3', 8));
    for (let number = 3; number <= 32; number++) {
      rows.push(track(number, `Project Hail Mary (${String(number).padStart(2, '0')}).mp3`, number - 3));
    }

    expect(playbackAfter(rows)).toEqual(Array.from({ length: 32 }, (_, index) => `Project Hail Mary (${String(index + 1).padStart(2, '0')}).mp3`));
    // Each track takes the number a scan of the whole folder gives it, so the next scan writes nothing.
    const updates = new Map(planAudioTrackOrderRepair(rows).map((update) => [update.id, update.sortOrder]));
    expect(updates.has(1)).toBe(false);
    expect(updates.has(2)).toBe(false);
    expect(updates.get(3)).toBe(9);
    expect(updates.get(32)).toBe(38);
  });

  it('places a track added without a number where its name puts it', () => {
    const rows = [track(1, 'Part 01.mp3', 0), track(2, 'Part 02.mp3', 1), track(3, 'Part 04.mp3', 2), track(4, 'Part 03.mp3', null)];

    expect(playbackAfter(rows)).toEqual(['Part 01.mp3', 'Part 02.mp3', 'Part 03.mp3', 'Part 04.mp3']);
    expect(planAudioTrackOrderRepair(rows)).toEqual([
      { id: 3, sortOrder: 3 },
      { id: 4, sortOrder: 2 },
    ]);
  });

  it('renumbers tracks an import numbered from zero after joining a book that already had tracks', () => {
    const rows = [track(1, 'Part 01.mp3', 0), track(2, 'Part 02.mp3', 1), track(3, 'Part 03.mp3', 0), track(4, 'Part 04.mp3', 1)];

    expect(playbackAfter(rows)).toEqual(['Part 01.mp3', 'Part 02.mp3', 'Part 03.mp3', 'Part 04.mp3']);
  });

  it('separates tracks that share a number, which would otherwise play in whatever order the rows load', () => {
    const rows = [track(1, 'Part 1.mp3', 0), track(2, 'Part 2.mp3', 0)];

    expect(planAudioTrackOrderRepair(rows)).toEqual([{ id: 2, sortOrder: 1 }]);
  });

  it('keeps disc folders playing disc by disc', () => {
    const rows = [track(1, 'CD 1/01.mp3', 2), track(2, 'CD 1/02.mp3', 3), track(3, 'CD 2/01.mp3', 0), track(4, 'CD 2/02.mp3', 1)];

    expect(playbackAfter(rows)).toEqual(['01.mp3', '02.mp3', '01.mp3', '02.mp3']);
    expect(planAudioTrackOrderRepair(rows)).toEqual([
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
      { id: 4, sortOrder: 3 },
    ]);
  });

  it('accepts names natural order cannot tell apart in either order, as a scan leaves them', () => {
    expect(planAudioTrackOrderRepair([track(1, 'track1.mp3', 0), track(2, 'track01.mp3', 1)])).toEqual([]);
    expect(planAudioTrackOrderRepair([track(1, 'track1.mp3', 1), track(2, 'track01.mp3', 0)])).toEqual([]);
  });

  it('numbers names natural order cannot tell apart the same way every time', () => {
    const rows = [track(1, 'track1.mp3', null), track(2, 'track01.mp3', null)];

    expect(planAudioTrackOrderRepair(rows)).toEqual(planAudioTrackOrderRepair([...rows].reverse()).reverse());
    expect(planAudioTrackOrderRepair(rows)).toEqual([
      { id: 1, sortOrder: 1 },
      { id: 2, sortOrder: 0 },
    ]);
  });

  it('never renumbers files that are not tracks', () => {
    const rows = [track(1, 'cover.jpg', null, 'jpg'), track(2, 'Part 2.mp3', 0), track(3, 'Part 1.mp3', 1), track(4, 'notes.nfo', null, null)];
    const updatedIds = planAudioTrackOrderRepair(rows).map((update) => update.id);

    expect(updatedIds.sort()).toEqual([2, 3]);
  });

  it('treats audio formats case-insensitively, as the player does', () => {
    const rows = [track(1, 'Part 1.MP3', 1, 'MP3'), track(2, 'Part 2.MP3', 0, 'MP3')];

    expect(playbackAfter(rows)).toEqual(['Part 1.MP3', 'Part 2.MP3']);
  });
});
