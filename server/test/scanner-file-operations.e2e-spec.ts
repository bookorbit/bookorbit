vi.mock('../src/modules/scanner/lib/stability', () => ({
  waitForStability: vi.fn().mockResolvedValue(undefined),
}));

import { randomUUID } from 'crypto';
import { mkdir, realpath, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, join, relative } from 'path';

import { and, count, eq, like } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { WATCHER_DEBOUNCE_MS } from '../src/modules/scanner/file-watcher.service';
import type { FixtureEntry, FixtureTree } from './e2e/scanner/scanner-fixture-builder';
import { createFixtureTree, file } from './e2e/scanner/scanner-fixture-builder';
import {
  assertNoIntegrityViolations,
  closeScannerE2EContext,
  createScannerE2EContext,
  loadLibraryBookState,
  seedLibrary,
  startLibraryWatcher,
  stopLibraryWatcher,
  triggerAndWaitForLibraryScan,
  waitForCondition,
  type LibraryBookState,
  type ScannerE2EContext,
} from './e2e/scanner/scanner-harness';

type OrganizationMode = 'book_per_file' | 'book_per_folder';
type TriggerMode = 'manual' | 'watcher';
type ScenarioStatus = 'passed' | 'failed' | 'skipped';
type LibraryKey = 'a' | 'b';
type BookStatus = 'present' | 'missing';

interface LibrarySetup {
  key: LibraryKey;
  rootDir: string;
  mode: OrganizationMode;
}

type FileOperation =
  | { type: 'deleteFile'; path: string }
  | { type: 'deleteDir'; path: string }
  | { type: 'move'; from: string; to: string }
  | { type: 'writeFile'; path: string; content?: string }
  | { type: 'sleep'; ms: number };

interface LibraryExpectation {
  statusByFolder: Record<string, BookStatus>;
  absentFolders?: string[];
  fileOwners?: Record<string, string>;
  absentFilePaths?: string[];
  presentCount?: number;
  missingCount?: number;
}

interface StructuralScenario {
  id: string;
  trigger: TriggerMode;
  libraries: LibrarySetup[];
  entries: FixtureEntry[];
  operations: FileOperation[];
  expected: Partial<Record<LibraryKey, LibraryExpectation>>;
  requiresCaseRename?: boolean;
}

interface ScenarioRunResult {
  id: string;
  trigger: TriggerMode;
  status: ScenarioStatus;
  durationMs: number;
  error?: string;
}

interface SeededLibrary {
  key: LibraryKey;
  rootPath: string;
  libraryId: number;
}

interface StatefulSnapshot {
  metadataTitle: string | null;
  metadataPublisher: string | null;
  bookAuthors: number;
  bookGenres: number;
  bookTags: number;
  bookNarrators: number;
  collectionBooks: number;
  userBookStatus: number;
  readingProgress: number;
  readingSessions: number;
  audiobookProgress: number;
  bookmarks: number;
  annotations: number;
  readerPreferences: number;
}

const SCENARIO_TIMEOUT_MS = 120_000;

const structuralScenarios: StructuralScenario[] = [
  {
    id: 'manual-delete-primary-file-marks-missing',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/book.epub')],
    operations: [{ type: 'deleteFile', path: 'lib-a/Book/book.epub' }],
    expected: { a: { statusByFolder: { Book: 'missing' }, presentCount: 0, missingCount: 1 } },
  },
  {
    id: 'manual-delete-folder-marks-only-removed-book-missing',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Shelf/BookOne/one.epub'), file('lib-a/Shelf/BookTwo/two.epub')],
    operations: [{ type: 'deleteDir', path: 'lib-a/Shelf/BookOne' }],
    expected: {
      a: {
        statusByFolder: {
          'Shelf/BookOne': 'missing',
          'Shelf/BookTwo': 'present',
        },
        presentCount: 1,
        missingCount: 1,
      },
    },
  },
  {
    id: 'manual-rename-file-in-place',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Book/book.epub', to: 'lib-a/Book/book-renamed.epub' }],
    expected: {
      a: {
        statusByFolder: { Book: 'present' },
        fileOwners: { 'Book/book-renamed.epub': 'Book' },
        absentFilePaths: ['Book/book.epub'],
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'manual-rename-folder',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Old/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Old', to: 'lib-a/New' }],
    expected: {
      a: {
        statusByFolder: { Old: 'missing', New: 'present' },
        fileOwners: { 'New/book.epub': 'New' },
        presentCount: 1,
        missingCount: 1,
      },
    },
  },
  {
    id: 'manual-move-root-file-into-subfolder',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/book.epub', to: 'lib-a/Shelf/book.epub' }],
    expected: {
      a: {
        statusByFolder: { 'book.epub': 'missing', Shelf: 'present' },
        fileOwners: { 'Shelf/book.epub': 'Shelf' },
        presentCount: 1,
        missingCount: 1,
      },
    },
  },
  {
    id: 'manual-move-subfolder-file-to-root',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Shelf/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Shelf/book.epub', to: 'lib-a/book.epub' }],
    expected: {
      a: {
        statusByFolder: { Shelf: 'missing', 'book.epub': 'present' },
        fileOwners: { 'book.epub': 'book.epub' },
        presentCount: 1,
        missingCount: 1,
      },
    },
  },
  {
    id: 'manual-cross-library-file-move',
    trigger: 'manual',
    libraries: [
      { key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' },
      { key: 'b', rootDir: 'lib-b', mode: 'book_per_folder' },
    ],
    entries: [file('lib-a/Book/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Book/book.epub', to: 'lib-b/Inbox/book.epub' }],
    expected: {
      a: { statusByFolder: {}, absentFolders: ['Book'], presentCount: 0, missingCount: 0 },
      b: {
        statusByFolder: { Inbox: 'present' },
        fileOwners: { 'Inbox/book.epub': 'Inbox' },
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'manual-cross-library-folder-move',
    trigger: 'manual',
    libraries: [
      { key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' },
      { key: 'b', rootDir: 'lib-b', mode: 'book_per_folder' },
    ],
    entries: [file('lib-a/Series/Book/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Series/Book', to: 'lib-b/Incoming/Book' }],
    expected: {
      a: { statusByFolder: {}, absentFolders: ['Series/Book'], presentCount: 0, missingCount: 0 },
      b: {
        statusByFolder: { 'Incoming/Book': 'present' },
        fileOwners: { 'Incoming/Book/book.epub': 'Incoming/Book' },
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'manual-multi-step-churn',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/A/One/one.epub'), file('lib-a/A/Two/two.epub')],
    operations: [
      { type: 'move', from: 'lib-a/A/One/one.epub', to: 'lib-a/A/One/one-renamed.epub' },
      { type: 'move', from: 'lib-a/A/Two', to: 'lib-a/B/Two' },
      { type: 'deleteFile', path: 'lib-a/A/One/one-renamed.epub' },
      { type: 'writeFile', path: 'lib-a/C/three.epub' },
    ],
    expected: {
      a: {
        statusByFolder: {
          'A/One': 'missing',
          'A/Two': 'missing',
          'B/Two': 'present',
          C: 'present',
        },
        fileOwners: {
          'B/Two/two.epub': 'B/Two',
          'C/three.epub': 'C',
        },
        presentCount: 2,
        missingCount: 2,
      },
    },
  },
  {
    id: 'manual-book-per-file-delete-and-move',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_file' }],
    entries: [file('lib-a/track1.mp3'), file('lib-a/track2.mp3')],
    operations: [
      { type: 'move', from: 'lib-a/track1.mp3', to: 'lib-a/Archive/track1.mp3' },
      { type: 'deleteFile', path: 'lib-a/track2.mp3' },
    ],
    expected: {
      a: {
        statusByFolder: {
          'track1.mp3': 'missing',
          'track2.mp3': 'missing',
          'Archive/track1.mp3': 'present',
        },
        fileOwners: { 'Archive/track1.mp3': 'Archive/track1.mp3' },
        presentCount: 1,
        missingCount: 2,
      },
    },
  },
  {
    id: 'manual-move-into-existing-folder-merges',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Source/source.epub'), file('lib-a/Destination/dest.epub')],
    operations: [{ type: 'move', from: 'lib-a/Source/source.epub', to: 'lib-a/Destination/source.epub' }],
    expected: {
      a: {
        statusByFolder: {
          Source: 'missing',
          Destination: 'present',
        },
        fileOwners: {
          'Destination/dest.epub': 'Destination',
          'Destination/source.epub': 'Destination',
        },
        absentFilePaths: ['Source/source.epub'],
        presentCount: 1,
        missingCount: 1,
      },
    },
  },
  {
    id: 'manual-cross-library-move-into-existing-folder-merges',
    trigger: 'manual',
    libraries: [
      { key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' },
      { key: 'b', rootDir: 'lib-b', mode: 'book_per_folder' },
    ],
    entries: [file('lib-a/Source/book.epub'), file('lib-b/Inbox/existing.epub')],
    operations: [{ type: 'move', from: 'lib-a/Source/book.epub', to: 'lib-b/Inbox/book.epub' }],
    expected: {
      a: {
        statusByFolder: { Source: 'missing' },
        presentCount: 0,
        missingCount: 1,
      },
      b: {
        statusByFolder: { Inbox: 'present' },
        fileOwners: {
          'Inbox/existing.epub': 'Inbox',
          'Inbox/book.epub': 'Inbox',
        },
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'manual-delete-and-recreate-same-path',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/book.epub')],
    operations: [
      { type: 'deleteFile', path: 'lib-a/Book/book.epub' },
      { type: 'writeFile', path: 'lib-a/Book/book.epub' },
    ],
    expected: { a: { statusByFolder: { Book: 'present' }, presentCount: 1, missingCount: 0 } },
  },
  {
    id: 'manual-delete-and-recreate-folder-with-new-file',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Swap/old.epub')],
    operations: [
      { type: 'deleteDir', path: 'lib-a/Swap' },
      { type: 'writeFile', path: 'lib-a/Swap/new.epub' },
    ],
    expected: {
      a: {
        statusByFolder: { Swap: 'present' },
        fileOwners: { 'Swap/new.epub': 'Swap' },
        absentFilePaths: ['Swap/old.epub'],
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'manual-book-per-file-folder-move-multi-file',
    trigger: 'manual',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_file' }],
    entries: [file('lib-a/Batch/one.mp3'), file('lib-a/Batch/two.mp3')],
    operations: [{ type: 'move', from: 'lib-a/Batch', to: 'lib-a/Archive/Batch' }],
    expected: {
      a: {
        statusByFolder: {
          'Batch/one.mp3': 'missing',
          'Batch/two.mp3': 'missing',
          'Archive/Batch/one.mp3': 'present',
          'Archive/Batch/two.mp3': 'present',
        },
        fileOwners: {
          'Archive/Batch/one.mp3': 'Archive/Batch/one.mp3',
          'Archive/Batch/two.mp3': 'Archive/Batch/two.mp3',
        },
        presentCount: 2,
        missingCount: 2,
      },
    },
  },
  {
    id: 'manual-cross-library-move-then-reseed-source',
    trigger: 'manual',
    libraries: [
      { key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' },
      { key: 'b', rootDir: 'lib-b', mode: 'book_per_folder' },
    ],
    entries: [file('lib-a/Book/book.epub')],
    operations: [
      { type: 'move', from: 'lib-a/Book/book.epub', to: 'lib-b/Inbox/book.epub' },
      { type: 'writeFile', path: 'lib-a/Book/book.epub' },
    ],
    expected: {
      a: {
        statusByFolder: { Book: 'present' },
        fileOwners: { 'Book/book.epub': 'Book' },
        presentCount: 1,
        missingCount: 0,
      },
      b: {
        statusByFolder: { Inbox: 'present' },
        fileOwners: { 'Inbox/book.epub': 'Inbox' },
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'watcher-delete-primary-file-marks-missing',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/book.epub')],
    operations: [{ type: 'deleteFile', path: 'lib-a/Book/book.epub' }],
    expected: { a: { statusByFolder: { Book: 'missing' }, presentCount: 0, missingCount: 1 } },
  },
  {
    id: 'watcher-delete-folder',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Shelf/One/one.epub'), file('lib-a/Shelf/Two/two.epub')],
    operations: [{ type: 'deleteDir', path: 'lib-a/Shelf/One' }],
    expected: {
      a: {
        statusByFolder: {
          'Shelf/One': 'missing',
          'Shelf/Two': 'present',
        },
        presentCount: 1,
        missingCount: 1,
      },
    },
  },
  {
    id: 'watcher-rename-file-in-place',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Book/book.epub', to: 'lib-a/Book/book-renamed.epub' }],
    expected: {
      a: {
        statusByFolder: { Book: 'present' },
        fileOwners: { 'Book/book-renamed.epub': 'Book' },
        absentFilePaths: ['Book/book.epub'],
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'watcher-rename-folder',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Old/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Old', to: 'lib-a/New' }],
    expected: {
      a: {
        statusByFolder: { New: 'present' },
        absentFolders: ['Old'],
        fileOwners: { 'New/book.epub': 'New' },
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'watcher-move-root-file-into-subfolder',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/book.epub', to: 'lib-a/Shelf/book.epub' }],
    expected: {
      a: {
        statusByFolder: { Shelf: 'present' },
        fileOwners: { 'Shelf/book.epub': 'Shelf' },
        presentCount: 1,
      },
    },
  },
  {
    id: 'watcher-move-subfolder-file-to-root',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Shelf/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Shelf/book.epub', to: 'lib-a/book.epub' }],
    expected: {
      a: {
        statusByFolder: { 'book.epub': 'present' },
        fileOwners: { 'book.epub': 'book.epub' },
        presentCount: 1,
      },
    },
  },
  {
    id: 'watcher-cross-library-file-move',
    trigger: 'watcher',
    libraries: [
      { key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' },
      { key: 'b', rootDir: 'lib-b', mode: 'book_per_folder' },
    ],
    entries: [file('lib-a/Book/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Book/book.epub', to: 'lib-b/Inbox/book.epub' }],
    expected: {
      a: { statusByFolder: {}, absentFolders: ['Book'], presentCount: 0, missingCount: 0 },
      b: {
        statusByFolder: { Inbox: 'present' },
        fileOwners: { 'Inbox/book.epub': 'Inbox' },
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'watcher-cross-library-folder-move',
    trigger: 'watcher',
    libraries: [
      { key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' },
      { key: 'b', rootDir: 'lib-b', mode: 'book_per_folder' },
    ],
    entries: [file('lib-a/Series/Book/book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Series/Book', to: 'lib-b/Incoming/Book' }],
    expected: {
      a: { statusByFolder: {}, absentFolders: ['Series/Book'], presentCount: 0, missingCount: 0 },
      b: {
        statusByFolder: { 'Incoming/Book': 'present' },
        fileOwners: { 'Incoming/Book/book.epub': 'Incoming/Book' },
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'watcher-case-only-file-rename',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/Book.epub')],
    operations: [{ type: 'move', from: 'lib-a/Book/Book.epub', to: 'lib-a/Book/book.epub' }],
    expected: {
      a: {
        statusByFolder: { Book: 'present' },
        fileOwners: { 'Book/book.epub': 'Book' },
        absentFilePaths: ['Book/Book.epub'],
        presentCount: 1,
      },
    },
    requiresCaseRename: true,
  },
  {
    id: 'watcher-non-content-file-creates-ignored',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/book.epub')],
    operations: [
      { type: 'writeFile', path: 'lib-a/Book/cover.jpg' },
      { type: 'writeFile', path: 'lib-a/Book/metadata.opf' },
    ],
    expected: { a: { statusByFolder: { Book: 'present' }, presentCount: 1, missingCount: 0 } },
  },
  {
    id: 'watcher-non-content-file-delete-ignored',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/book.epub'), file('lib-a/Book/cover.jpg')],
    operations: [{ type: 'deleteFile', path: 'lib-a/Book/cover.jpg' }],
    expected: { a: { statusByFolder: { Book: 'present' }, presentCount: 1, missingCount: 0 } },
  },
  {
    id: 'watcher-book-per-file-delete-then-restore',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_file' }],
    entries: [file('lib-a/Track.mp3')],
    operations: [
      { type: 'deleteFile', path: 'lib-a/Track.mp3' },
      { type: 'sleep', ms: WATCHER_DEBOUNCE_MS + 400 },
      { type: 'writeFile', path: 'lib-a/Track.mp3' },
    ],
    expected: { a: { statusByFolder: { 'Track.mp3': 'present' }, presentCount: 1, missingCount: 0 } },
  },
  {
    id: 'watcher-move-into-existing-folder-merges',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Source/source.epub'), file('lib-a/Destination/dest.epub')],
    operations: [{ type: 'move', from: 'lib-a/Source/source.epub', to: 'lib-a/Destination/source.epub' }],
    expected: {
      a: {
        statusByFolder: {
          Source: 'missing',
          Destination: 'present',
        },
        fileOwners: {
          'Destination/dest.epub': 'Destination',
          'Destination/source.epub': 'Destination',
        },
        absentFilePaths: ['Source/source.epub'],
        presentCount: 1,
        missingCount: 1,
      },
    },
  },
  {
    id: 'watcher-delete-and-recreate-same-path-within-debounce',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Book/book.epub')],
    operations: [
      { type: 'deleteFile', path: 'lib-a/Book/book.epub' },
      { type: 'writeFile', path: 'lib-a/Book/book.epub' },
    ],
    expected: { a: { statusByFolder: { Book: 'present' }, presentCount: 1, missingCount: 0 } },
  },
  {
    id: 'watcher-delete-and-recreate-folder-with-new-file',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [file('lib-a/Swap/old.epub')],
    operations: [
      { type: 'deleteDir', path: 'lib-a/Swap' },
      { type: 'sleep', ms: WATCHER_DEBOUNCE_MS + 400 },
      { type: 'writeFile', path: 'lib-a/Swap/new.epub' },
    ],
    expected: {
      a: {
        statusByFolder: { Swap: 'present' },
        fileOwners: { 'Swap/new.epub': 'Swap' },
        absentFilePaths: ['Swap/old.epub'],
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'watcher-cross-library-move-then-reseed-source',
    trigger: 'watcher',
    libraries: [
      { key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' },
      { key: 'b', rootDir: 'lib-b', mode: 'book_per_folder' },
    ],
    entries: [file('lib-a/Book/book.epub')],
    operations: [
      { type: 'move', from: 'lib-a/Book/book.epub', to: 'lib-b/Inbox/book.epub' },
      { type: 'sleep', ms: WATCHER_DEBOUNCE_MS + 400 },
      { type: 'writeFile', path: 'lib-a/Book/book.epub' },
    ],
    expected: {
      a: {
        statusByFolder: { Book: 'present' },
        fileOwners: { 'Book/book.epub': 'Book' },
        presentCount: 1,
        missingCount: 0,
      },
      b: {
        statusByFolder: { Inbox: 'present' },
        fileOwners: { 'Inbox/book.epub': 'Inbox' },
        presentCount: 1,
        missingCount: 0,
      },
    },
  },
  {
    id: 'watcher-create-then-delete-new-path-within-debounce',
    trigger: 'watcher',
    libraries: [{ key: 'a', rootDir: 'lib-a', mode: 'book_per_folder' }],
    entries: [],
    operations: [
      { type: 'writeFile', path: 'lib-a/Temp/new.epub' },
      { type: 'deleteFile', path: 'lib-a/Temp/new.epub' },
    ],
    expected: {
      a: {
        statusByFolder: {},
        presentCount: 0,
        missingCount: 0,
      },
    },
  },
  {
    id: 'watcher-book-per-file-cross-library-folder-move-multi-file',
    trigger: 'watcher',
    libraries: [
      { key: 'a', rootDir: 'lib-a', mode: 'book_per_file' },
      { key: 'b', rootDir: 'lib-b', mode: 'book_per_file' },
    ],
    entries: [file('lib-a/Batch/one.mp3'), file('lib-a/Batch/two.mp3')],
    operations: [{ type: 'move', from: 'lib-a/Batch', to: 'lib-b/Import/Batch' }],
    expected: {
      a: {
        statusByFolder: {},
        absentFolders: ['Batch/one.mp3', 'Batch/two.mp3'],
        presentCount: 0,
        missingCount: 0,
      },
      b: {
        statusByFolder: {
          'Import/Batch/one.mp3': 'present',
          'Import/Batch/two.mp3': 'present',
        },
        fileOwners: {
          'Import/Batch/one.mp3': 'Import/Batch/one.mp3',
          'Import/Batch/two.mp3': 'Import/Batch/two.mp3',
        },
        presentCount: 2,
        missingCount: 0,
      },
    },
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyOperation(rootPath: string, operation: FileOperation): Promise<void> {
  switch (operation.type) {
    case 'deleteFile':
      await rm(join(rootPath, operation.path), { force: true });
      break;
    case 'deleteDir':
      await rm(join(rootPath, operation.path), { recursive: true, force: true });
      break;
    case 'move': {
      const from = join(rootPath, operation.from);
      const to = join(rootPath, operation.to);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      break;
    }
    case 'writeFile': {
      const outputPath = join(rootPath, operation.path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, operation.content ?? `${operation.path}\n`.repeat(600));
      break;
    }
    case 'sleep':
      await sleep(operation.ms);
      break;
  }
}

function assertLibraryExpectation(rootPath: string, actual: LibraryBookState[], expectation: LibraryExpectation): void {
  const byFolder = new Map(actual.map((book) => [relative(rootPath, book.folderPath), book]));

  for (const [folderPath, status] of Object.entries(expectation.statusByFolder)) {
    const book = byFolder.get(folderPath);
    expect(book, `expected book for folder "${folderPath}"`).toBeDefined();
    expect(book!.status).toBe(status);
  }

  for (const folderPath of expectation.absentFolders ?? []) {
    expect(byFolder.has(folderPath), `folder "${folderPath}" should be absent`).toBe(false);
  }

  if (expectation.presentCount !== undefined) {
    expect(actual.filter((book) => book.status === 'present')).toHaveLength(expectation.presentCount);
  }

  if (expectation.missingCount !== undefined) {
    expect(actual.filter((book) => book.status === 'missing')).toHaveLength(expectation.missingCount);
  }

  for (const [filePath, expectedOwnerFolder] of Object.entries(expectation.fileOwners ?? {})) {
    const absoluteFilePath = join(rootPath, filePath);
    const owners = actual
      .filter((book) => book.filePaths.includes(absoluteFilePath))
      .map((book) => relative(rootPath, book.folderPath))
      .sort();
    expect(owners).toEqual([expectedOwnerFolder]);
  }

  for (const filePath of expectation.absentFilePaths ?? []) {
    const absoluteFilePath = join(rootPath, filePath);
    const owners = actual.filter((book) => book.filePaths.includes(absoluteFilePath));
    expect(owners, `file "${filePath}" should not be owned by any book`).toHaveLength(0);
  }
}

async function resetScannerFileOpsState(db: ScannerE2EContext['db']): Promise<void> {
  await db.delete(schema.libraries).where(like(schema.libraries.name, 'scanner-file-ops-%'));
  await db.delete(schema.users).where(like(schema.users.username, 'state-user-%'));
}

async function supportsCaseOnlyRename(rootPath: string): Promise<boolean> {
  const probeDir = join(rootPath, 'case-probe');
  const upperPath = join(probeDir, 'CaseProbe.epub');
  const lowerPath = join(probeDir, 'caseprobe.epub');
  await mkdir(probeDir, { recursive: true });
  await writeFile(upperPath, 'probe');
  try {
    await rename(upperPath, lowerPath);
    const renamed = await stat(lowerPath).catch(() => null);
    return renamed?.isFile() ?? false;
  } catch {
    return false;
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }
}

function seededLibraryByKey(seeded: SeededLibrary[], key: LibraryKey): SeededLibrary {
  const lib = seeded.find((entry) => entry.key === key);
  if (!lib) throw new Error(`Missing seeded library for key "${key}"`);
  return lib;
}

async function assertScenarioExpectations(
  context: ScannerE2EContext,
  seeded: SeededLibrary[],
  expected: Partial<Record<LibraryKey, LibraryExpectation>>,
): Promise<void> {
  for (const key of Object.keys(expected) as LibraryKey[]) {
    const expectation = expected[key];
    if (!expectation) continue;
    const lib = seededLibraryByKey(seeded, key);
    const actual = await loadLibraryBookState(context.db, lib.libraryId);
    assertLibraryExpectation(lib.rootPath, actual, expectation);
  }
}

async function runStructuralScenario(context: ScannerE2EContext, scenario: StructuralScenario, results: ScenarioRunResult[]): Promise<void> {
  const fixture = await createFixtureTree(scenario.entries, `scanner-file-ops-${scenario.id}-`);
  const startedAt = Date.now();
  const seeded: SeededLibrary[] = [];
  const startedWatchers: number[] = [];

  try {
    await resetScannerFileOpsState(context.db);

    if (scenario.requiresCaseRename && !(await supportsCaseOnlyRename(fixture.rootPath))) {
      results.push({
        id: scenario.id,
        trigger: scenario.trigger,
        status: 'skipped',
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    for (const library of scenario.libraries) {
      const requestedRootPath = join(fixture.rootPath, library.rootDir);
      await mkdir(requestedRootPath, { recursive: true });
      const rootPath = await realpath(requestedRootPath);
      const seededLibrary = await seedLibrary(context.db, {
        rootPath,
        mode: library.mode,
        watch: false,
        name: `scanner-file-ops-${scenario.id}-${library.key}-${randomUUID()}`,
      });
      seeded.push({
        key: library.key,
        rootPath,
        libraryId: seededLibrary.libraryId,
      });
    }

    for (const library of seeded) {
      await triggerAndWaitForLibraryScan(context, library.libraryId);
    }

    if (scenario.trigger === 'watcher') {
      for (const library of seeded) {
        await startLibraryWatcher(context, library.libraryId, [library.rootPath]);
        startedWatchers.push(library.libraryId);
      }
    }

    for (const operation of scenario.operations) {
      await applyOperation(fixture.rootPath, operation);
    }

    if (scenario.trigger === 'manual') {
      for (const library of seeded) {
        await triggerAndWaitForLibraryScan(context, library.libraryId);
      }
      await assertScenarioExpectations(context, seeded, scenario.expected);
      await assertNoIntegrityViolations(context.db);
    } else {
      await waitForCondition(async () => {
        await assertScenarioExpectations(context, seeded, scenario.expected);
        await assertNoIntegrityViolations(context.db);
      }, 40_000);
    }

    results.push({
      id: scenario.id,
      trigger: scenario.trigger,
      status: 'passed',
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    results.push({
      id: scenario.id,
      trigger: scenario.trigger,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    for (const libraryId of startedWatchers) {
      await stopLibraryWatcher(context, libraryId);
    }
    await fixture.cleanup();
  }
}

async function getBookByFolderPath(db: ScannerE2EContext['db'], libraryId: number, folderPath: string): Promise<typeof schema.books.$inferSelect> {
  const [book] = await db
    .select()
    .from(schema.books)
    .where(and(eq(schema.books.libraryId, libraryId), eq(schema.books.folderPath, folderPath)))
    .limit(1);
  if (!book) {
    throw new Error(`Book not found for library=${libraryId} folderPath="${folderPath}"`);
  }
  return book;
}

async function getBookById(db: ScannerE2EContext['db'], bookId: number): Promise<typeof schema.books.$inferSelect> {
  const [book] = await db.select().from(schema.books).where(eq(schema.books.id, bookId)).limit(1);
  if (!book) {
    throw new Error(`Book id=${bookId} not found`);
  }
  return book;
}

async function createRegularUsers(db: ScannerE2EContext['db']): Promise<[number, number]> {
  const suffix = randomUUID();
  const users = await db
    .insert(schema.users)
    .values([
      {
        username: `state-user-a-${suffix}`,
        name: 'State User A',
        email: `state-user-a-${suffix}@example.com`,
        passwordHash: `hash-${suffix}-a`,
        isSuperuser: false,
      },
      {
        username: `state-user-b-${suffix}`,
        name: 'State User B',
        email: `state-user-b-${suffix}@example.com`,
        passwordHash: `hash-${suffix}-b`,
        isSuperuser: false,
      },
    ])
    .returning({ id: schema.users.id });
  return [users[0]!.id, users[1]!.id];
}

async function loadStatefulSnapshot(db: ScannerE2EContext['db'], bookId: number, primaryFileId: number): Promise<StatefulSnapshot> {
  const [metadata] = await db
    .select({ title: schema.bookMetadata.title, publisher: schema.bookMetadata.publisher })
    .from(schema.bookMetadata)
    .where(eq(schema.bookMetadata.bookId, bookId))
    .limit(1);

  const [bookAuthors] = await db.select({ value: count() }).from(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, bookId));
  const [bookGenres] = await db.select({ value: count() }).from(schema.bookGenres).where(eq(schema.bookGenres.bookId, bookId));
  const [bookTags] = await db.select({ value: count() }).from(schema.bookTags).where(eq(schema.bookTags.bookId, bookId));
  const [bookNarrators] = await db.select({ value: count() }).from(schema.bookNarrators).where(eq(schema.bookNarrators.bookId, bookId));
  const [collectionBooks] = await db.select({ value: count() }).from(schema.collectionBooks).where(eq(schema.collectionBooks.bookId, bookId));
  const [userBookStatus] = await db.select({ value: count() }).from(schema.userBookStatus).where(eq(schema.userBookStatus.bookId, bookId));
  const [readingProgress] = await db
    .select({ value: count() })
    .from(schema.readingProgress)
    .where(eq(schema.readingProgress.bookFileId, primaryFileId));
  const [readingSessions] = await db
    .select({ value: count() })
    .from(schema.readingSessions)
    .where(eq(schema.readingSessions.bookFileId, primaryFileId));
  const [audiobookProgress] = await db.select({ value: count() }).from(schema.audiobookProgress).where(eq(schema.audiobookProgress.bookId, bookId));
  const [bookmarks] = await db.select({ value: count() }).from(schema.bookmarks).where(eq(schema.bookmarks.bookId, bookId));
  const [annotations] = await db.select({ value: count() }).from(schema.annotations).where(eq(schema.annotations.bookId, bookId));
  const [readerPreferences] = await db
    .select({ value: count() })
    .from(schema.readerPreferences)
    .where(eq(schema.readerPreferences.bookFileId, primaryFileId));

  return {
    metadataTitle: metadata?.title ?? null,
    metadataPublisher: metadata?.publisher ?? null,
    bookAuthors: Number(bookAuthors.value),
    bookGenres: Number(bookGenres.value),
    bookTags: Number(bookTags.value),
    bookNarrators: Number(bookNarrators.value),
    collectionBooks: Number(collectionBooks.value),
    userBookStatus: Number(userBookStatus.value),
    readingProgress: Number(readingProgress.value),
    readingSessions: Number(readingSessions.value),
    audiobookProgress: Number(audiobookProgress.value),
    bookmarks: Number(bookmarks.value),
    annotations: Number(annotations.value),
    readerPreferences: Number(readerPreferences.value),
  };
}

async function seedStatefulData(db: ScannerE2EContext['db'], bookId: number, primaryFileId: number): Promise<{ snapshot: StatefulSnapshot }> {
  const [userA, userB] = await createRegularUsers(db);
  const suffix = randomUUID();
  const now = new Date();

  await db
    .update(schema.bookMetadata)
    .set({
      title: 'Stateful Scanner Fixture',
      publisher: 'Stateful Publishing',
      seriesName: 'Scanner Stateful Series',
      seriesIndex: 1,
    })
    .where(eq(schema.bookMetadata.bookId, bookId));

  const [author] = await db
    .insert(schema.authors)
    .values({ name: `State Author ${suffix}` })
    .returning({ id: schema.authors.id });
  await db.insert(schema.bookAuthors).values({ bookId, authorId: author.id, displayOrder: 0 });

  const [genre] = await db
    .insert(schema.genres)
    .values({ name: `State Genre ${suffix}` })
    .returning({ id: schema.genres.id });
  await db.insert(schema.bookGenres).values({ bookId, genreId: genre.id });

  const [tag] = await db
    .insert(schema.tags)
    .values({ name: `State Tag ${suffix}` })
    .returning({ id: schema.tags.id });
  await db.insert(schema.bookTags).values({ bookId, tagId: tag.id });

  const [narrator] = await db
    .insert(schema.narrators)
    .values({ name: `State Narrator ${suffix}` })
    .returning({ id: schema.narrators.id });
  await db.insert(schema.bookNarrators).values({ bookId, narratorId: narrator.id, displayOrder: 0 });

  const [collection] = await db
    .insert(schema.collections)
    .values({ userId: userA, name: `State Collection ${suffix}`, description: 'Stateful collection fixture' })
    .returning({ id: schema.collections.id });
  await db.insert(schema.collectionBooks).values({ collectionId: collection.id, bookId });

  await db.insert(schema.userBookStatus).values([
    { userId: userA, bookId, status: 'reading', source: 'manual' },
    { userId: userB, bookId, status: 'on_hold', source: 'manual' },
  ]);

  await db.insert(schema.readingProgress).values([
    { userId: userA, bookFileId: primaryFileId, percentage: 42.5, positionSeconds: 220.5, pageNumber: 12 },
    { userId: userB, bookFileId: primaryFileId, percentage: 17.25, positionSeconds: 80.25, pageNumber: 4 },
  ]);

  await db.insert(schema.readingSessions).values([
    {
      userId: userA,
      bookFileId: primaryFileId,
      sessionId: `session-${suffix}-a`,
      startedAt: new Date(now.getTime() - 300_000),
      endedAt: new Date(now.getTime() - 240_000),
      durationSeconds: 60,
      progressDelta: 2.5,
      endProgress: 42.5,
    },
    {
      userId: userB,
      bookFileId: primaryFileId,
      sessionId: `session-${suffix}-b`,
      startedAt: new Date(now.getTime() - 180_000),
      endedAt: new Date(now.getTime() - 120_000),
      durationSeconds: 60,
      progressDelta: 1.5,
      endProgress: 17.25,
    },
  ]);

  await db.insert(schema.audiobookProgress).values({ userId: userA, bookId, currentFileId: primaryFileId, percentage: 42.5, positionSeconds: 220.5 });

  await db.insert(schema.bookmarks).values([
    { userId: userA, bookId, title: 'State Bookmark A', cfi: 'epubcfi(/6/2[chapter1]!/4/2/14)' },
    { userId: userB, bookId, title: 'State Bookmark B', cfi: 'epubcfi(/6/4[chapter2]!/4/6/8)' },
  ]);

  await db.insert(schema.annotations).values([
    {
      userId: userA,
      bookId,
      cfi: 'epubcfi(/6/2[chapter1]!/4/2/14)',
      text: 'State annotation A',
      color: 'yellow',
      style: 'highlight',
    },
    {
      userId: userB,
      bookId,
      cfi: 'epubcfi(/6/4[chapter2]!/4/6/8)',
      text: 'State annotation B',
      color: 'green',
      style: 'underline',
    },
  ]);

  await db.insert(schema.readerPreferences).values({ userId: userA, bookFileId: primaryFileId, settings: { fontSize: 17, lineHeight: 1.6 } });

  return {
    snapshot: await loadStatefulSnapshot(db, bookId, primaryFileId),
  };
}

async function assertStatefulUnchanged(
  db: ScannerE2EContext['db'],
  bookId: number,
  primaryFileId: number,
  expectedSnapshot: StatefulSnapshot,
): Promise<void> {
  const actual = await loadStatefulSnapshot(db, bookId, primaryFileId);
  expect(actual).toEqual(expectedSnapshot);
}

async function writeScenarioReport(results: ScenarioRunResult[]): Promise<void> {
  const reportDir = process.env.JUNIT_OUTPUT ? dirname(process.env.JUNIT_OUTPUT) : join(process.cwd(), '..', 'test-results', 'server');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'scanner-file-ops-e2e-scenarios.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((result) => result.status === 'passed').length,
        failed: results.filter((result) => result.status === 'failed').length,
        skipped: results.filter((result) => result.status === 'skipped').length,
        results,
      },
      null,
      2,
    ),
  );
}

interface StatefulScenario {
  id: string;
  trigger: TriggerMode;
  fixturePrefix: string;
  fixtureEntries: FixtureEntry[];
  run: (context: ScannerE2EContext, fixture: FixtureTree) => Promise<void>;
}

async function runStatefulScenario(context: ScannerE2EContext, scenario: StatefulScenario, results: ScenarioRunResult[]): Promise<void> {
  const startedAt = Date.now();
  await resetScannerFileOpsState(context.db);
  const fixture = await createFixtureTree(scenario.fixtureEntries, scenario.fixturePrefix);
  try {
    await scenario.run(context, fixture);
    results.push({ id: scenario.id, trigger: scenario.trigger, status: 'passed', durationMs: Date.now() - startedAt });
  } catch (err) {
    results.push({
      id: scenario.id,
      trigger: scenario.trigger,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    await fixture.cleanup();
  }
}

const statefulScenarios: StatefulScenario[] = [
  {
    id: 'stateful-manual-delete-primary-preserves-data',
    trigger: 'manual',
    fixturePrefix: 'scanner-file-ops-stateful-manual-delete-',
    fixtureEntries: [file('lib-a/Book/book.epub')],
    run: async (context, fixture) => {
      const requestedRootA = join(fixture.rootPath, 'lib-a');
      await mkdir(requestedRootA, { recursive: true });
      const rootA = await realpath(requestedRootA);
      const library = await seedLibrary(context.db, {
        rootPath: rootA,
        mode: 'book_per_folder',
        watch: false,
        name: `scanner-file-ops-stateful-manual-delete-${randomUUID()}`,
      });

      await triggerAndWaitForLibraryScan(context, library.libraryId);

      const sourceBook = await getBookByFolderPath(context.db, library.libraryId, join(rootA, 'Book'));
      if (sourceBook.primaryFileId == null) throw new Error('Expected primary file id to be present');

      const seeded = await seedStatefulData(context.db, sourceBook.id, sourceBook.primaryFileId);

      await applyOperation(fixture.rootPath, { type: 'deleteFile', path: 'lib-a/Book/book.epub' });
      await triggerAndWaitForLibraryScan(context, library.libraryId);

      const sourceAfter = await getBookById(context.db, sourceBook.id);
      expect(sourceAfter.status).toBe('missing');

      await assertStatefulUnchanged(context.db, sourceBook.id, sourceBook.primaryFileId, seeded.snapshot);
      await assertNoIntegrityViolations(context.db);
    },
  },
  {
    id: 'stateful-manual-cross-library-move-preserves-book-identity',
    trigger: 'manual',
    fixturePrefix: 'scanner-file-ops-stateful-cross-lib-manual-',
    fixtureEntries: [file('lib-a/Book/book.epub')],
    run: async (context, fixture) => {
      const requestedRootA = join(fixture.rootPath, 'lib-a');
      const requestedRootB = join(fixture.rootPath, 'lib-b');
      await mkdir(requestedRootA, { recursive: true });
      await mkdir(requestedRootB, { recursive: true });
      const rootA = await realpath(requestedRootA);
      const rootB = await realpath(requestedRootB);

      const sourceLibrary = await seedLibrary(context.db, {
        rootPath: rootA,
        mode: 'book_per_folder',
        watch: false,
        name: `scanner-file-ops-stateful-source-${randomUUID()}`,
      });
      const destinationLibrary = await seedLibrary(context.db, {
        rootPath: rootB,
        mode: 'book_per_folder',
        watch: false,
        name: `scanner-file-ops-stateful-destination-${randomUUID()}`,
      });

      await triggerAndWaitForLibraryScan(context, sourceLibrary.libraryId);
      await triggerAndWaitForLibraryScan(context, destinationLibrary.libraryId);

      const sourceBook = await getBookByFolderPath(context.db, sourceLibrary.libraryId, join(rootA, 'Book'));
      if (sourceBook.primaryFileId == null) throw new Error('Expected source primary file id to be present');

      const seeded = await seedStatefulData(context.db, sourceBook.id, sourceBook.primaryFileId);

      await applyOperation(fixture.rootPath, { type: 'move', from: 'lib-a/Book/book.epub', to: 'lib-b/Inbox/book.epub' });

      await triggerAndWaitForLibraryScan(context, sourceLibrary.libraryId);
      await triggerAndWaitForLibraryScan(context, destinationLibrary.libraryId);

      const movedBook = await getBookById(context.db, sourceBook.id);
      expect(movedBook.libraryId).toBe(destinationLibrary.libraryId);
      expect(movedBook.status).toBe('present');
      expect(movedBook.folderPath).toBe(join(rootB, 'Inbox'));
      expect(movedBook.primaryFileId).toBe(sourceBook.primaryFileId);

      const destinationBook = await getBookByFolderPath(context.db, destinationLibrary.libraryId, join(rootB, 'Inbox'));
      expect(destinationBook.id).toBe(sourceBook.id);
      expect(destinationBook.status).toBe('present');
      expect(destinationBook.primaryFileId).toBe(sourceBook.primaryFileId);

      const sourceState = await loadLibraryBookState(context.db, sourceLibrary.libraryId);
      expect(sourceState).toHaveLength(0);

      await assertStatefulUnchanged(context.db, sourceBook.id, sourceBook.primaryFileId, seeded.snapshot);
      await assertNoIntegrityViolations(context.db);
    },
  },
  {
    id: 'stateful-watcher-cross-library-move-preserves-book-identity',
    trigger: 'watcher',
    fixturePrefix: 'scanner-file-ops-stateful-cross-lib-watcher-',
    fixtureEntries: [file('lib-a/Book/book.epub')],
    run: async (context, fixture) => {
      const requestedRootA = join(fixture.rootPath, 'lib-a');
      const requestedRootB = join(fixture.rootPath, 'lib-b');
      await mkdir(requestedRootA, { recursive: true });
      await mkdir(requestedRootB, { recursive: true });
      const rootA = await realpath(requestedRootA);
      const rootB = await realpath(requestedRootB);

      let sourceLibraryId: number | null = null;
      let destinationLibraryId: number | null = null;
      try {
        const sourceLibrary = await seedLibrary(context.db, {
          rootPath: rootA,
          mode: 'book_per_folder',
          watch: false,
          name: `scanner-file-ops-stateful-source-watcher-${randomUUID()}`,
        });
        sourceLibraryId = sourceLibrary.libraryId;
        const destinationLibrary = await seedLibrary(context.db, {
          rootPath: rootB,
          mode: 'book_per_folder',
          watch: false,
          name: `scanner-file-ops-stateful-destination-watcher-${randomUUID()}`,
        });
        destinationLibraryId = destinationLibrary.libraryId;

        await triggerAndWaitForLibraryScan(context, sourceLibrary.libraryId);
        await triggerAndWaitForLibraryScan(context, destinationLibrary.libraryId);

        const sourceBook = await getBookByFolderPath(context.db, sourceLibrary.libraryId, join(rootA, 'Book'));
        if (sourceBook.primaryFileId == null) throw new Error('Expected source primary file id to be present');

        const seeded = await seedStatefulData(context.db, sourceBook.id, sourceBook.primaryFileId);

        await startLibraryWatcher(context, sourceLibrary.libraryId, [rootA]);
        await startLibraryWatcher(context, destinationLibrary.libraryId, [rootB]);
        await applyOperation(fixture.rootPath, { type: 'move', from: 'lib-a/Book/book.epub', to: 'lib-b/Inbox/book.epub' });

        await waitForCondition(async () => {
          const movedBook = await getBookById(context.db, sourceBook.id);
          expect(movedBook.libraryId).toBe(destinationLibrary.libraryId);
          expect(movedBook.status).toBe('present');
          expect(movedBook.folderPath).toBe(join(rootB, 'Inbox'));
          expect(movedBook.primaryFileId).toBe(sourceBook.primaryFileId);

          const destinationBook = await getBookByFolderPath(context.db, destinationLibrary.libraryId, join(rootB, 'Inbox'));
          expect(destinationBook.id).toBe(sourceBook.id);
          expect(destinationBook.primaryFileId).toBe(sourceBook.primaryFileId);

          const sourceState = await loadLibraryBookState(context.db, sourceLibrary.libraryId);
          expect(sourceState).toHaveLength(0);
        }, 40_000);

        await assertStatefulUnchanged(context.db, sourceBook.id, sourceBook.primaryFileId, seeded.snapshot);
        await assertNoIntegrityViolations(context.db);
      } finally {
        if (sourceLibraryId != null) await stopLibraryWatcher(context, sourceLibraryId);
        if (destinationLibraryId != null) await stopLibraryWatcher(context, destinationLibraryId);
      }
    },
  },
  {
    id: 'stateful-watcher-rename-folder-preserves-data',
    trigger: 'watcher',
    fixturePrefix: 'scanner-file-ops-stateful-watcher-rename-',
    fixtureEntries: [file('lib-a/Old/book.epub')],
    run: async (context, fixture) => {
      const requestedRootA = join(fixture.rootPath, 'lib-a');
      await mkdir(requestedRootA, { recursive: true });
      const rootA = await realpath(requestedRootA);
      let libraryId: number | null = null;
      try {
        const library = await seedLibrary(context.db, {
          rootPath: rootA,
          mode: 'book_per_folder',
          watch: false,
          name: `scanner-file-ops-stateful-watcher-rename-${randomUUID()}`,
        });
        libraryId = library.libraryId;

        await triggerAndWaitForLibraryScan(context, library.libraryId);

        const sourceBook = await getBookByFolderPath(context.db, library.libraryId, join(rootA, 'Old'));
        if (sourceBook.primaryFileId == null) throw new Error('Expected source primary file id to be present');

        const seeded = await seedStatefulData(context.db, sourceBook.id, sourceBook.primaryFileId);

        await startLibraryWatcher(context, library.libraryId, [rootA]);
        await applyOperation(fixture.rootPath, { type: 'move', from: 'lib-a/Old', to: 'lib-a/New' });

        await waitForCondition(async () => {
          const book = await getBookById(context.db, sourceBook.id);
          expect(book.status).toBe('present');
          expect(book.folderPath).toBe(join(rootA, 'New'));
        }, 40_000);

        await assertStatefulUnchanged(context.db, sourceBook.id, sourceBook.primaryFileId, seeded.snapshot);
        await assertNoIntegrityViolations(context.db);
      } finally {
        if (libraryId != null) await stopLibraryWatcher(context, libraryId);
      }
    },
  },
  {
    id: 'stateful-watcher-delete-then-restore-preserves-data',
    trigger: 'watcher',
    fixturePrefix: 'scanner-file-ops-stateful-watcher-delete-restore-',
    fixtureEntries: [file('lib-a/Book/book.epub')],
    run: async (context, fixture) => {
      const requestedRootA = join(fixture.rootPath, 'lib-a');
      await mkdir(requestedRootA, { recursive: true });
      const rootA = await realpath(requestedRootA);
      let libraryId: number | null = null;
      try {
        const library = await seedLibrary(context.db, {
          rootPath: rootA,
          mode: 'book_per_folder',
          watch: false,
          name: `scanner-file-ops-stateful-watcher-delete-restore-${randomUUID()}`,
        });
        libraryId = library.libraryId;

        await triggerAndWaitForLibraryScan(context, library.libraryId);

        const sourceBook = await getBookByFolderPath(context.db, library.libraryId, join(rootA, 'Book'));
        if (sourceBook.primaryFileId == null) throw new Error('Expected source primary file id to be present');

        const seeded = await seedStatefulData(context.db, sourceBook.id, sourceBook.primaryFileId);

        await startLibraryWatcher(context, library.libraryId, [rootA]);

        await applyOperation(fixture.rootPath, { type: 'deleteFile', path: 'lib-a/Book/book.epub' });

        await waitForCondition(async () => {
          const book = await getBookById(context.db, sourceBook.id);
          expect(book.status).toBe('missing');
        }, 40_000);

        await applyOperation(fixture.rootPath, { type: 'writeFile', path: 'lib-a/Book/book.epub' });

        await waitForCondition(async () => {
          const book = await getBookById(context.db, sourceBook.id);
          expect(book.status).toBe('present');
        }, 40_000);

        await assertStatefulUnchanged(context.db, sourceBook.id, sourceBook.primaryFileId, seeded.snapshot);
        await assertNoIntegrityViolations(context.db);
      } finally {
        if (libraryId != null) await stopLibraryWatcher(context, libraryId);
      }
    },
  },
];

describe('Scanner file operations (e2e)', () => {
  let context: ScannerE2EContext | null = null;
  const scenarioResults: ScenarioRunResult[] = [];

  beforeAll(async () => {
    context = await createScannerE2EContext();
  });

  afterAll(async () => {
    if (context) {
      await assertNoIntegrityViolations(context.db);
    }
    await writeScenarioReport(scenarioResults);
    if (context) {
      await closeScannerE2EContext(context);
    }
  });

  describe('structural scenarios', () => {
    for (const scenario of structuralScenarios) {
      it(
        scenario.id,
        async () => {
          if (!context) throw new Error('E2E context not initialized');
          await runStructuralScenario(context, scenario, scenarioResults);
        },
        SCENARIO_TIMEOUT_MS,
      );
    }
  });

  describe('stateful consistency scenarios', () => {
    for (const scenario of statefulScenarios) {
      it(
        scenario.id,
        async () => {
          if (!context) throw new Error('E2E context not initialized');
          await runStatefulScenario(context, scenario, scenarioResults);
        },
        SCENARIO_TIMEOUT_MS,
      );
    }
  });
});
