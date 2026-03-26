#!/usr/bin/env bash
# Seeds synthetic reading sessions and daily stats for the first user so that
# all user-statistics charts (heatmap, peak hours, completion timeline, etc.)
# show realistic data out of the box.
#
# Safe to run multiple times - sessions are deduplicated by session_id and
# daily stats are upserted. Running again adds more data on top.
#
# Usage: ./scripts/seed/reading-sessions.sh [USER_ID]
#   USER_ID defaults to 1.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

POSTGRES_USER="${POSTGRES_USER:-projectx}"
POSTGRES_DB="${POSTGRES_DB:-projectx}"
TARGET_USER_ID="${1:-1}"

echo "Seeding reading sessions for user_id=${TARGET_USER_ID}..."

docker compose -f docker-compose.dev.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" << EOSQL

DO \$\$
DECLARE
  v_user_id    int := ${TARGET_USER_ID};
  v_day        date;
  v_file_id    int;
  v_library_id int;
  v_sessions   int;
  v_i          int;
  v_hour       int;
  v_duration   int;
  v_started    timestamptz;
  v_ended      timestamptz;
  v_end_pct    real;
  v_delta      real;
  v_session_id text;
  v_dow        int;
  v_file_ids   int[];
  v_total_sessions int := 0;
  v_total_completions int := 0;
BEGIN
  -- Verify user exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'User with id % not found', v_user_id;
  END IF;

  -- Verify there are book files to work with
  IF NOT EXISTS (SELECT 1 FROM book_files LIMIT 1) THEN
    RAISE EXCEPTION 'No book files found - scan a library first';
  END IF;

  -- Pick up to 40 real file ids to spread sessions across
  SELECT array_agg(id ORDER BY random()) INTO v_file_ids
  FROM (SELECT id FROM book_files ORDER BY random() LIMIT 40) t;

  -- Spread books.added_at across the past 3 years so Format Share Over Time
  -- chart has data across multiple months instead of a single spike today.
  UPDATE books SET added_at = now() - (random() * interval '3 years')
  WHERE added_at > now() - interval '7 days';

  -- Insert sessions across the past 365 days
  FOR v_day IN
    SELECT generate_series(
      current_date - interval '364 days',
      current_date,
      interval '1 day'
    )::date
  LOOP
    v_dow := extract(dow from v_day); -- 0=Sun 6=Sat

    -- Weekends: 1-3 sessions. Weekdays: 0-2 (30% chance of 0).
    IF v_dow IN (0, 6) THEN
      v_sessions := 1 + floor(random() * 3)::int;
    ELSIF random() < 0.30 THEN
      v_sessions := 0;
    ELSE
      v_sessions := 1 + floor(random() * 2)::int;
    END IF;

    FOR v_i IN 1..v_sessions LOOP
      v_file_id := v_file_ids[1 + floor(random() * array_length(v_file_ids, 1))::int];

      SELECT b.library_id INTO v_library_id
      FROM book_files bf JOIN books b ON b.id = bf.book_id
      WHERE bf.id = v_file_id;

      -- Realistic hour distribution: mostly evenings, some mornings/afternoons
      IF random() < 0.60 THEN
        v_hour := 18 + floor(random() * 6)::int;  -- 18-23 evening
      ELSIF random() < 0.50 THEN
        v_hour := 7  + floor(random() * 3)::int;  -- 7-9 morning
      ELSE
        v_hour := 12 + floor(random() * 4)::int;  -- 12-15 afternoon
      END IF;

      v_started  := (v_day + make_interval(hours => v_hour, mins => floor(random() * 60)::int))::timestamptz;
      v_duration := 600 + floor(random() * 3000)::int;   -- 10-60 min
      v_ended    := v_started + make_interval(secs => v_duration);
      v_delta    := round((1 + random() * 8)::numeric, 4); -- 1-9% progress
      -- ~15% of sessions are completions (every 7th deterministically by loop)
      IF (v_total_sessions % 7) = 0 THEN
        v_end_pct := 100;
        v_total_completions := v_total_completions + 1;
      ELSE
        v_end_pct := round((10 + random() * 80)::numeric, 2);
      END IF;

      v_session_id := md5(v_user_id::text || v_file_id::text || v_started::text || v_i::text);

      INSERT INTO reading_sessions
        (user_id, book_file_id, session_id, started_at, ended_at, duration_seconds, progress_delta, end_progress)
      VALUES
        (v_user_id, v_file_id, v_session_id, v_started, v_ended, v_duration, v_delta, v_end_pct)
      ON CONFLICT (session_id) DO NOTHING;

      -- Real-time upsert of daily stats (mirrors what the server does on session save)
      INSERT INTO user_reading_daily_stats
        (user_id, library_id, day, reading_seconds, progress_delta, sessions_count, updated_at)
      VALUES
        (v_user_id, v_library_id, v_day, v_duration, v_delta, 1, now())
      ON CONFLICT (user_id, library_id, day) DO UPDATE SET
        reading_seconds = user_reading_daily_stats.reading_seconds + excluded.reading_seconds,
        progress_delta  = user_reading_daily_stats.progress_delta  + excluded.progress_delta,
        sessions_count  = user_reading_daily_stats.sessions_count  + 1,
        updated_at      = now();

      v_total_sessions := v_total_sessions + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Done: % sessions inserted (% completions)', v_total_sessions, v_total_completions;
END;
\$\$;

EOSQL

echo "Reading session seed complete."
