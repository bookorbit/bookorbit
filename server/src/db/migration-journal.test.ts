import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

type MigrationJournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: MigrationJournalEntry[];
};

const migrationsDirUrl = new URL('./migrations/', import.meta.url);
const journalPath = fileURLToPath(new URL('./meta/_journal.json', migrationsDirUrl));
const migrationsDir = fileURLToPath(migrationsDirUrl);

function readJournal(): MigrationJournal {
  return JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;
}

function migrationPrefix(idx: number): string {
  return idx.toString().padStart(4, '0');
}

describe('Drizzle migration journal', () => {
  it('keeps migration timestamps strictly increasing in journal order', () => {
    const journal = readJournal();

    for (let i = 0; i < journal.entries.length; i += 1) {
      const entry = journal.entries[i];
      const previous = journal.entries[i - 1];
      const prefix = migrationPrefix(i);

      expect(entry.idx).toBe(i);
      expect(entry.tag.startsWith(`${prefix}_`)).toBe(true);
      expect(Number.isSafeInteger(entry.when)).toBe(true);
      expect(entry.when).toBeGreaterThan(0);
      expect(existsSync(fileURLToPath(new URL(`./${entry.tag}.sql`, migrationsDirUrl)))).toBe(true);
      expect(existsSync(fileURLToPath(new URL(`./meta/${prefix}_snapshot.json`, migrationsDirUrl)))).toBe(true);

      if (previous) {
        expect(entry.when, `${entry.tag} must have a later journal timestamp than ${previous.tag}`).toBeGreaterThan(previous.when);
      }
    }
  });

  it('keeps the journal in sync with migration SQL files', () => {
    const journalTags = readJournal().entries.map((entry) => entry.tag);
    const fileTags = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => basename(file, '.sql'))
      .sort();

    expect(journalTags).toEqual(fileTags);
    expect(new Set(journalTags).size).toBe(journalTags.length);
  });
});
