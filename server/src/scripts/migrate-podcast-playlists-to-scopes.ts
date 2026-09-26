import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../db/schema';
import { libraries, smartScopes, userPreferences } from '../db/schema';
import { createPostgresClientConfig } from '../db/postgres-connection-config';
import { planPlaylistMigration } from '../modules/smart-scope/utils/podcast-playlist-migration';

/**
 * Moves saved podcast playlists out of the user_preferences blob into podcast smart scopes.
 *
 * Idempotent: a scope is only written when the user has no podcast scope of that name yet, and the
 * source preference row is left untouched, so a re-run converges instead of duplicating. Pass
 * --apply to write; the default is a dry run that reports what would happen.
 */
const PREFERENCE_CATEGORY = 'podcast-playlists';

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool(createPostgresClientConfig(connectionString, { max: 3 }));
  const db = drizzle(pool, { schema });

  let migrated = 0;
  let skipped = 0;
  let alreadyPresent = 0;

  try {
    // Read the raw jsonb: the sanitized accessor drops a user's whole list when any playlist
    // uses the `pinned` filter its schema omits.
    const rows = await db
      .select({ userId: userPreferences.userId, data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.category, PREFERENCE_CATEGORY));

    console.log(`[playlist_migration] [start] users=${rows.length} apply=${apply} - migration started`);

    const podcastLibraryIds = new Set((await db.select({ id: libraries.id }).from(libraries).where(eq(libraries.type, 'podcasts'))).map((r) => r.id));

    for (const row of rows) {
      const existing = await db
        .select({ name: smartScopes.name })
        .from(smartScopes)
        .where(and(eq(smartScopes.userId, row.userId), eq(smartScopes.mediaType, 'podcasts')));

      const plan = planPlaylistMigration(
        row.data,
        existing.map((scope) => scope.name),
      );

      for (const entry of plan.skipped) {
        skipped += 1;
        console.warn(`[playlist_migration] [skip] userId=${row.userId} name="${entry.name}" reason="${entry.reason}"`);
      }

      for (const scope of plan.scopes) {
        // A playlist can outlive the library it pointed at; that scope would violate the FK.
        if (!podcastLibraryIds.has(scope.libraryId)) {
          skipped += 1;
          console.warn(
            `[playlist_migration] [skip] userId=${row.userId} name="${scope.name}" reason="library ${scope.libraryId} is not a podcast library"`,
          );
          continue;
        }

        if (!apply) {
          migrated += 1;
          console.log(`[playlist_migration] [plan] userId=${row.userId} name="${scope.name}" libraryId=${scope.libraryId} - would create`);
          continue;
        }

        const inserted = await db
          .insert(smartScopes)
          .values({
            userId: row.userId,
            mediaType: 'podcasts',
            libraryId: scope.libraryId,
            name: scope.name,
            icon: scope.icon,
            filter: scope.filter,
            defaultSort: [],
            displayOrder: 0,
            isPublic: false,
            syncToKobo: false,
          })
          .onConflictDoNothing({ target: [smartScopes.userId, smartScopes.mediaType, smartScopes.name] })
          .returning({ id: smartScopes.id });

        if (inserted.length > 0) {
          migrated += 1;
          console.log(`[playlist_migration] [ok] userId=${row.userId} scopeId=${inserted[0].id} name="${scope.name}" - created`);
        } else {
          alreadyPresent += 1;
        }
      }
    }

    console.log(
      `[playlist_migration] [end] apply=${apply} migrated=${migrated} alreadyPresent=${alreadyPresent} skipped=${skipped} - migration finished`,
    );
    if (!apply) console.log('[playlist_migration] dry run only; re-run with --apply to write');
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`[playlist_migration] [fail] error="${error instanceof Error ? error.message : String(error)}"`);
  process.exitCode = 1;
});
