/**
 * Read-only smoke test for the position converter: converts every koreader-origin
 * annotation in the database from xpointer to CFI (verified against the stored
 * highlight text), then round-trips back, and prints per-annotation results.
 *
 * Usage: cd server && npx tsx src/scripts/annotation-conversion-smoke.ts
 */
import { existsSync } from 'fs';
import { loadEnvFile } from 'node:process';
import { Client } from 'pg';
import * as unzipper from 'unzipper';

import { loadChapterFromZip, readEpubSpine } from '../modules/position-converter/epub-dom.service';
import { cfiRangeToXPointer, xpointerRangeToCfi } from '../modules/position-converter/position-converter.core';
import { parseXPointer } from '../modules/position-converter/xpointer.utils';

if (existsSync('.env')) {
  loadEnvFile('.env');
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{
    id: number;
    text: string | null;
    pos0: string;
    pos1: string | null;
    absolute_path: string;
  }>(`
    select a.id, a.text, ap.pos0, ap.pos1, bf.absolute_path
    from annotations a
    join annotation_positions ap on ap.annotation_id = a.id and ap.format = 'xpointer'
    join book_files bf on bf.id = ap.book_file_id
    where a.origin = 'koreader'
    order by a.id
  `);
  await client.end();

  const zipCache = new Map<string, { zip: unzipper.CentralDirectory; spine: string[] }>();
  let exact = 0;
  let repaired = 0;
  let failed = 0;
  let roundTripOk = 0;

  for (const row of rows) {
    let entry = zipCache.get(row.absolute_path);
    if (!entry) {
      const zip = await unzipper.Open.file(row.absolute_path);
      const spine = (await readEpubSpine(zip)).hrefs;
      entry = { zip, spine };
      zipCache.set(row.absolute_path, entry);
    }
    const parsed = parseXPointer(row.pos0);
    if (!parsed) {
      console.log(`#${row.id} UNPARSABLE ${row.pos0}`);
      failed += 1;
      continue;
    }
    const chapterIndex = parsed.docFragmentIndex - 1;
    const href = entry.spine[chapterIndex];
    if (!href) {
      console.log(`#${row.id} NO_CHAPTER idx=${chapterIndex} spineLen=${entry.spine.length}`);
      failed += 1;
      continue;
    }
    const doc = await loadChapterFromZip(entry.zip, href);
    if (!doc) {
      console.log(`#${row.id} CHAPTER_LOAD_FAILED ${href}`);
      failed += 1;
      continue;
    }
    const result = xpointerRangeToCfi(doc, chapterIndex, row.pos0, row.pos1, row.text);
    if (result.status === 'failed') {
      console.log(`#${row.id} FAILED reason=${result.reason} pos0=${row.pos0} text="${(row.text ?? '').slice(0, 50)}"`);
      failed += 1;
      continue;
    }
    if (result.status === 'exact') exact += 1;
    else repaired += 1;

    const back = cfiRangeToXPointer(doc, chapterIndex, result.pos0, row.text);
    const rt = back.status !== 'failed' && back.pos0 === row.pos0 && back.pos1 === row.pos1;
    if (rt) roundTripOk += 1;
    console.log(`#${row.id} ${result.status.toUpperCase()} rt=${rt ? 'OK' : 'DIFF'} cfi=${result.pos0.slice(0, 70)}`);
    if (!rt) {
      if (back.status === 'failed') {
        console.log(`    back FAILED reason=${back.reason}`);
      } else {
        console.log(`    orig0=${row.pos0}\n    back0=${back.pos0}\n    orig1=${row.pos1}\n    back1=${back.pos1}`);
      }
    }
  }

  console.log(`\nTotal=${rows.length} exact=${exact} repaired=${repaired} failed=${failed} roundTrip=${roundTripOk}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
