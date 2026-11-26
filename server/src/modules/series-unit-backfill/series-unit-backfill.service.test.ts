import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FOLDER_SERIES_REGEX_METADATA,
  type RegexMetadataConfig,
  type RegexMetadataDiagnosticCode,
  type RegexMetadataPreview,
} from '@bookorbit/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { RegexMetadataService } from '../metadata/regex/regex-metadata.service';
import { SeriesUnitBackfillRepository, type SeriesUnitBackfillCandidate } from './series-unit-backfill.repository';
import { SeriesUnitBackfillService } from './series-unit-backfill.service';

const RULES: RegexMetadataConfig = FOLDER_SERIES_REGEX_METADATA;

function candidate(
  bookId: number,
  relPath: string,
  seriesIndex: string,
  overrides: Partial<SeriesUnitBackfillCandidate> = {},
): SeriesUnitBackfillCandidate {
  return { bookId, libraryId: 1, relPath, seriesIndex, lockedFields: [], rules: RULES, ...overrides };
}

function matched(metadata: RegexMetadataPreview['metadata']): RegexMetadataPreview {
  return { inputPath: '', matched: true, ruleIndex: 0, groups: {}, metadata, diagnostics: [] };
}

function failed(code: RegexMetadataDiagnosticCode): RegexMetadataPreview {
  return { inputPath: '', matched: false, ruleIndex: null, groups: {}, metadata: {}, diagnostics: [{ code }] };
}

/** Reads the unit and numbers from names like `v03 c012`, `c020` or `#7`, as the Series Folders preset does. */
function evaluateByName(_rules: RegexMetadataConfig, relPath: string): Promise<RegexMetadataPreview> {
  const volume = /v(\d+)/.exec(relPath)?.[1];
  const chapter = /c(\d+)/.exec(relPath)?.[1];
  if (chapter)
    return Promise.resolve(
      matched({ seriesIndex: String(Number(chapter)), seriesUnit: 'chapter', seriesVolumeIndex: volume && String(Number(volume)) }),
    );
  if (volume) return Promise.resolve(matched({ seriesIndex: String(Number(volume)), seriesUnit: 'volume' }));
  return Promise.resolve(matched({ seriesIndex: '5' }));
}

describe('SeriesUnitBackfillService', () => {
  let service: SeriesUnitBackfillService;
  let batches: SeriesUnitBackfillCandidate[][];
  let flag: string | null;
  const regex = { stopping: false, evaluate: vi.fn<RegexMetadataService['evaluate']>() };
  const repository = {
    findCandidates: vi.fn<SeriesUnitBackfillRepository['findCandidates']>(),
    writeUnits: vi.fn<SeriesUnitBackfillRepository['writeUnits']>(),
  };
  const appSettings = { getValue: vi.fn<AppSettingsService['getValue']>(), setValue: vi.fn<AppSettingsService['setValue']>() };

  const written = () => repository.writeUnits.mock.calls.flatMap(([writes]) => writes);
  const writtenIds = () => written().map((write) => write.bookId);

  beforeEach(async () => {
    batches = [];
    flag = null;
    regex.stopping = false;
    regex.evaluate.mockReset().mockImplementation(evaluateByName);
    repository.findCandidates.mockReset().mockImplementation((after) => Promise.resolve(batches.find((batch) => batch[0]!.bookId > after) ?? []));
    repository.writeUnits.mockReset().mockImplementation((writes) => Promise.resolve(writes.map((write) => write.bookId)));
    appSettings.getValue.mockReset().mockImplementation(() => Promise.resolve(flag));
    appSettings.setValue.mockReset().mockImplementation((_key, value) => {
      flag = value;
      return Promise.resolve();
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        SeriesUnitBackfillService,
        { provide: SeriesUnitBackfillRepository, useValue: repository },
        { provide: RegexMetadataService, useValue: regex },
        { provide: AppSettingsService, useValue: appSettings },
      ],
    }).compile();
    service = moduleRef.get(SeriesUnitBackfillService);
  });

  it('sets the unit a file name names, keeps a chapter volume number, and writes the flag after the pass', async () => {
    batches = [[candidate(1, 'Vagabond/Vagabond v01.cbz', '1'), candidate(2, 'Vagabond/Vagabond v03 c012.cbz', '12')]];

    const counts = await service.runOnce();

    expect(written()).toEqual([
      { bookId: 1, seriesIndex: '1', unit: 'volume', volumeIndex: null },
      { bookId: 2, seriesIndex: '12', unit: 'chapter', volumeIndex: '3' },
    ]);
    expect(counts).toMatchObject({ scanned: 2, updated: 2, volume: 1, chapter: 1, failed: 0 });
    expect(appSettings.setValue).toHaveBeenCalledWith(APP_SETTING_KEYS.SERIES_UNITS_BACKFILLED, expect.any(String));
  });

  it('does nothing once an earlier boot finished the pass', async () => {
    flag = '2026-11-26T00:00:00.000Z';

    await expect(service.runOnce()).resolves.toBeNull();

    expect(repository.findCandidates).not.toHaveBeenCalled();
  });

  it('never gives a volume a volume number, even when the rules read one', async () => {
    regex.evaluate.mockResolvedValue(matched({ seriesIndex: '4', seriesUnit: 'volume', seriesVolumeIndex: '9' }));
    batches = [[candidate(1, 'Berserk/Berserk v04.cbz', '4')]];

    await service.runOnce();

    expect(written()).toEqual([{ bookId: 1, seriesIndex: '4', unit: 'volume', volumeIndex: null }]);
  });

  it('leaves locked books, bare numbers and numbers the book does not keep alone', async () => {
    batches = [
      [
        candidate(1, 'Vagabond/Vagabond c030.cbz', '30', { lockedFields: ['seriesIndex'] }),
        candidate(2, 'Vagabond/Vagabond 005.cbz', '5'),
        candidate(3, 'Vagabond/Vagabond c020.cbz', '7'),
        candidate(4, 'Vagabond/Vagabond v02.epub', '2'),
      ],
    ];

    const counts = await service.runOnce();

    expect(repository.writeUnits).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ scanned: 4, locked: 1, updated: 0 });
    expect(regex.evaluate).toHaveBeenCalledTimes(2);
  });

  it('skips a book whose rules time out and goes on with the rest', async () => {
    regex.evaluate.mockImplementation((rules, relPath) =>
      relPath.includes('v02') ? Promise.resolve(failed('timeout')) : evaluateByName(rules, relPath),
    );
    batches = [[candidate(1, 'S/S v01.cbz', '1'), candidate(2, 'S/S v02.cbz', '2'), candidate(3, 'S/S v03.cbz', '3')]];

    const counts = await service.runOnce();

    expect(writtenIds()).toEqual([1, 3]);
    expect(counts).toMatchObject({ updated: 2, failed: 1, skipped: 0 });
    expect(flag).not.toBeNull();
  });

  it('sets a library aside after three timeouts and leaves the flag for the next boot', async () => {
    regex.evaluate.mockImplementation((rules, relPath) =>
      relPath.startsWith('Slow/') ? Promise.resolve(failed('timeout')) : evaluateByName(rules, relPath),
    );
    batches = [
      [...[1, 2, 3, 4, 5].map((id) => candidate(id, `Slow/S v0${id}.cbz`, String(id))), candidate(6, 'Fast/F v01.cbz', '1', { libraryId: 2 })],
    ];

    await expect(service.runOnce()).resolves.toBeNull();

    expect(regex.evaluate).toHaveBeenCalledTimes(4);
    expect(writtenIds()).toEqual([6]);
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('sets a library with rules that cannot compile aside after one book and still finishes', async () => {
    regex.evaluate.mockImplementation((rules, relPath) =>
      relPath.startsWith('Broken/') ? Promise.resolve(failed('invalid_pattern')) : evaluateByName(rules, relPath),
    );
    batches = [
      [
        candidate(1, 'Broken/B v01.cbz', '1', { libraryId: 7 }),
        candidate(2, 'Broken/B v02.cbz', '2', { libraryId: 7 }),
        candidate(3, 'Good/G v01.cbz', '1', { libraryId: 8 }),
      ],
    ];

    const counts = await service.runOnce();

    expect(regex.evaluate).toHaveBeenCalledTimes(2);
    expect(writtenIds()).toEqual([3]);
    expect(counts).toMatchObject({ failed: 1, skipped: 1, updated: 1 });
    expect(flag).not.toBeNull();
  });

  it('sets a library aside when the evaluator refuses its rules outright', async () => {
    regex.evaluate.mockImplementation((rules, relPath) => {
      if (relPath.startsWith('Refused/')) return Promise.reject(new BadRequestException('Invalid regex metadata rules or flags'));
      return evaluateByName(rules, relPath);
    });
    batches = [
      [
        candidate(1, 'Refused/R v01.cbz', '1', { libraryId: 7 }),
        candidate(2, 'Refused/R v02.cbz', '2', { libraryId: 7 }),
        candidate(3, 'Good/G v01.cbz', '1', { libraryId: 8 }),
      ],
    ];

    const counts = await service.runOnce();

    expect(regex.evaluate).toHaveBeenCalledTimes(2);
    expect(writtenIds()).toEqual([3]);
    expect(counts).toMatchObject({ failed: 1, skipped: 1 });
    expect(flag).not.toBeNull();
  });

  it('passes over a library whose stored rules have the wrong shape', async () => {
    batches = [
      [
        candidate(1, 'Odd/O v01.cbz', '1', { libraryId: 7, rules: { rules: null } as unknown as RegexMetadataConfig }),
        candidate(2, 'Good/G v01.cbz', '1', { libraryId: 8 }),
      ],
    ];

    await service.runOnce();

    expect(regex.evaluate).toHaveBeenCalledTimes(1);
    expect(writtenIds()).toEqual([2]);
    expect(flag).not.toBeNull();
  });

  it('stops when the server shuts the worker pool down, keeps what it classified, and leaves the flag', async () => {
    regex.evaluate.mockImplementation((rules, relPath) => {
      if (!relPath.includes('v02')) return evaluateByName(rules, relPath);
      regex.stopping = true;
      return Promise.resolve(failed('worker_failed'));
    });
    batches = [
      [candidate(1, 'S/S v01.cbz', '1'), candidate(2, 'S/S v02.cbz', '2'), candidate(3, 'S/S v03.cbz', '3')],
      [candidate(4, 'S/S v04.cbz', '4')],
    ];

    await expect(service.runOnce()).resolves.toBeNull();

    expect(writtenIds()).toEqual([1]);
    expect(regex.evaluate).toHaveBeenCalledTimes(2);
    expect(repository.findCandidates).toHaveBeenCalledTimes(1);
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('stops before the next batch once the module is destroyed', async () => {
    batches = [[candidate(1, 'S/S v01.cbz', '1')], [candidate(2, 'S/S v02.cbz', '2')]];
    repository.writeUnits.mockImplementationOnce((writes) => {
      void service.onModuleDestroy();
      return Promise.resolve(writes.map((write) => write.bookId));
    });

    await expect(service.runOnce()).resolves.toBeNull();

    expect(writtenIds()).toEqual([1]);
    expect(repository.findCandidates).toHaveBeenCalledTimes(1);
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('writes a refused batch book by book, so one bad row does not cost the rest', async () => {
    repository.writeUnits.mockRejectedValueOnce(new Error('check constraint violated'));
    repository.writeUnits.mockResolvedValueOnce([1]);
    repository.writeUnits.mockRejectedValueOnce(new Error('check constraint violated'));
    repository.writeUnits.mockResolvedValueOnce([3]);
    batches = [[candidate(1, 'S/S v01.cbz', '1'), candidate(2, 'S/S v02.cbz', '2'), candidate(3, 'S/S v03.cbz', '3')]];

    const counts = await service.runOnce();

    expect(repository.writeUnits).toHaveBeenCalledTimes(4);
    expect(counts).toMatchObject({ updated: 2, failed: 1, volume: 2 });
    expect(flag).not.toBeNull();
  });

  it('ends the pass without the flag when every write fails', async () => {
    repository.writeUnits.mockRejectedValue(new Error('connection terminated'));
    batches = [[candidate(1, 'S/S v01.cbz', '1'), candidate(2, 'S/S v02.cbz', '2')]];

    await expect(service.runOnce()).resolves.toBeNull();

    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('counts only the books the guarded write changed', async () => {
    repository.writeUnits.mockResolvedValueOnce([2]);
    batches = [[candidate(1, 'S/S v01.cbz', '1'), candidate(2, 'S/S v02 c007.cbz', '7')]];

    const counts = await service.runOnce();

    expect(counts).toMatchObject({ updated: 1, volume: 0, chapter: 1 });
  });

  it('joins a pass already running instead of starting a second one', async () => {
    batches = [[candidate(1, 'S/S v01.cbz', '1')]];

    const [first, second] = await Promise.all([service.runOnce(), service.runOnce()]);

    expect(first).toBe(second);
    expect(repository.findCandidates).toHaveBeenCalledTimes(2);
    expect(writtenIds()).toEqual([1]);
  });
});
