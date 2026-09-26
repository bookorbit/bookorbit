import { Client } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';
import { createPostgresClientConfig } from '../db/postgres-connection-config';

/**
 * Registers the Kokoro TTS provider, or points the existing row at a new address.
 *
 * Kokoro is an ordinary openai-compatible provider, so this only writes the row the admin screen
 * would have written. It is matched by name rather than by URL so that re-running it after moving
 * Kokoro updates the provider readers already have selected instead of adding a second one.
 *
 * `staticVoices` is deliberately left null: an uncurated provider offers everything its own listing
 * reports, and curation belongs in the admin UI once you have heard a few.
 */
const PROVIDER_NAME = process.env.KOKORO_PROVIDER_NAME ?? 'Kokoro';
const DEFAULT_BASE_URL = 'http://localhost:8880/v1';
const DEFAULT_MODEL = 'kokoro';

async function run(): Promise<void> {
  const event = 'tts.register_kokoro';
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  const baseUrl = (process.env.KOKORO_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error(`KOKORO_BASE_URL must start with http:// or https://, received "${baseUrl}"`);
  }

  const client = new Client(createPostgresClientConfig(connectionString));
  await client.connect();
  try {
    const existing = await client.query<{ id: number; base_url: string | null }>('select id, base_url from tts_providers where name = $1 limit 1', [
      PROVIDER_NAME,
    ]);

    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      await client.query(
        'update tts_providers set base_url = $1, default_model = $2, enabled = true, supports_voice_discovery = true, updated_at = now() where id = $3',
        [baseUrl, DEFAULT_MODEL, row.id],
      );
      console.log(`[${event}] [end] providerId=${row.id} baseUrl="${baseUrl}" action=updated - kokoro provider updated`);
      return;
    }

    const inserted = await client.query<{ id: number }>(
      `insert into tts_providers (name, type, enabled, base_url, default_model, supports_voice_discovery, display_order)
       values ($1, 'openai-compatible', true, $2, $3, true, coalesce((select max(display_order) + 1 from tts_providers), 0))
       returning id`,
      [PROVIDER_NAME, baseUrl, DEFAULT_MODEL],
    );
    console.log(`[${event}] [end] providerId=${inserted.rows[0]!.id} baseUrl="${baseUrl}" action=created - kokoro provider registered`);
  } finally {
    await client.end();
  }
}

void run().catch((error: unknown) => {
  console.error(
    `[tts.register_kokoro] [fail] errorClass=${error instanceof Error ? error.name : 'Unknown'} error="${sanitizeLogValue(error instanceof Error ? error.message : error)}"`,
  );
  process.exitCode = 1;
});
