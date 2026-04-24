#!/usr/bin/env bash
# Seeds data for dashboard widgets for user_id=1.
# Covers: Highlight of the Day, Monthly Challenge, Year Projection,
#         Neglected Gems, Reading DNA, The Long Wait,
#         Diversity Score, Reading Rhythm.
#
# Safe to run multiple times - uses INSERT ... ON CONFLICT DO NOTHING / DO UPDATE.
# Usage: ./scripts/fixtures/seed-dashboard-widgets.sh [USER_ID]

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

POSTGRES_USER="${POSTGRES_USER:-bookorbit}"
POSTGRES_DB="${POSTGRES_DB:-bookorbit}"
TARGET_USER_ID="${1:-1}"

echo "Seeding dashboard widget data for user_id=${TARGET_USER_ID}..."

docker compose -f docker-compose.dev.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" << EOSQL

DO \$\$
DECLARE
  v_uid         int  := ${TARGET_USER_ID};
  v_book_id     int;
  v_lib_id      int;
  v_day         date;
  v_secs        int;
  i             int;
BEGIN

  -- ─── Pick a library (superuser sees all libraries) ────────────────────────
  SELECT id INTO v_lib_id FROM libraries ORDER BY id LIMIT 1;

  IF v_lib_id IS NULL THEN
    RAISE EXCEPTION 'No libraries found in the database. Create a library first.';
  END IF;

  RAISE NOTICE 'Using library_id=%', v_lib_id;

  -- ─── WIDGET 1: Highlight of the Day ───────────────────────────────────────
  -- Need 15+ annotations with real-looking highlight text.
  -- Pick the first book that belongs to this user's library.
  SELECT b.id INTO v_book_id
  FROM books b
  WHERE b.library_id = v_lib_id AND b.status = 'present'
  LIMIT 1;

  IF v_book_id IS NOT NULL THEN
    INSERT INTO annotations (user_id, book_id, cfi, text, style, chapter_title, created_at, updated_at)
    VALUES
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/2)', 'The man who does not read has no advantage over the man who cannot read.', 'highlight', 'Preface', now() - interval '10 days', now() - interval '10 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/4)', 'Not all those who wander are lost; the roots of some are deeper than most.', 'highlight', 'Chapter 1', now() - interval '9 days', now() - interval '9 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/6)', 'It is our choices that show what we truly are, far more than our abilities.', 'highlight', 'Chapter 2', now() - interval '8 days', now() - interval '8 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/8)', 'In the middle of every difficulty lies opportunity. The curious mind finds it first.', 'highlight', 'Chapter 3', now() - interval '7 days', now() - interval '7 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/10)', 'Words are, in my not-so-humble opinion, our most inexhaustible source of magic.', 'highlight', 'Chapter 4', now() - interval '6 days', now() - interval '6 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/12)', 'A reader lives a thousand lives before he dies. The man who never reads lives only one.', 'highlight', 'Chapter 5', now() - interval '5 days', now() - interval '5 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/14)', 'The more that you read, the more things you will know. The more that you learn, the more places you will go.', 'highlight', 'Chapter 6', now() - interval '4 days', now() - interval '4 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/16)', 'Until I feared I would lose it, I never loved to read. One does not love breathing.', 'highlight', 'Chapter 7', now() - interval '3 days', now() - interval '3 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/18)', 'I declare after all there is no enjoyment like reading! How much sooner one tires of any thing than of a book!', 'highlight', 'Chapter 8', now() - interval '2 days', now() - interval '2 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/20)', 'There is no friend as loyal as a book. It waits for you without judgment, always open.', 'highlight', 'Chapter 9', now() - interval '1 day', now() - interval '1 day'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/22)', 'Reading gives us someplace to go when we have to stay where we are.', 'highlight', 'Chapter 10', now(), now()),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/24)', 'One must always be careful of books, and what is inside them, for words have the power to change us.', 'highlight', 'Chapter 11', now() - interval '12 days', now() - interval '12 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/26)', 'The world was hers for the reading.', 'highlight', 'Chapter 12', now() - interval '11 days', now() - interval '11 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/28)', 'Books are mirrors: you only see in them what you already have inside you.', 'underline', 'Chapter 13', now() - interval '13 days', now() - interval '13 days'),
      (v_uid, v_book_id, 'epubcfi(/6/4!/4/2/30)', 'I took a deep breath and listened to the old brag of my heart: I am, I am, I am.', 'highlight', 'Chapter 14', now() - interval '14 days', now() - interval '14 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE 'Annotations: inserted up to 15 highlights for book_id=%', v_book_id;
  END IF;

  -- ─── WIDGET 3: Monthly Challenge ───────────────────────────────────────────
  -- Need user_reading_daily_stats with a recent streak + books finished this month.
  -- Daily stats already seeded by seed-reading-sessions.sh; just ensure this month
  -- has solid data (upsert so we don't lose existing stats).
  FOR i IN 1..28 LOOP
    v_day := date_trunc('month', current_date) + ((i - 1) * interval '1 day');
    IF v_day <= current_date THEN
      v_secs := CASE WHEN (i % 7 < 2) THEN 600 ELSE 2400 + (i * 120) END;
      INSERT INTO user_reading_daily_stats (user_id, library_id, day, reading_seconds, progress_delta, sessions_count, updated_at)
      VALUES (v_uid, v_lib_id, v_day, v_secs, 0.02 + (i % 5) * 0.01, 2, now())
      ON CONFLICT (user_id, library_id, day) DO UPDATE
        SET reading_seconds = GREATEST(user_reading_daily_stats.reading_seconds, EXCLUDED.reading_seconds),
            updated_at = EXCLUDED.updated_at;
    END IF;
  END LOOP;
  RAISE NOTICE 'Monthly Challenge: upserted daily stats for current month';

  -- ─── WIDGET 4: Year Projection ─────────────────────────────────────────────
  -- Need books marked 'read' with finished_at spread across this year.
  i := 0;
  FOR v_book_id IN
    SELECT b.id
    FROM books b
    LEFT JOIN user_book_status ubs ON ubs.book_id = b.id AND ubs.user_id = v_uid
    WHERE b.library_id = v_lib_id AND b.status = 'present'
      AND (ubs.status IS NULL OR ubs.status NOT IN ('read', 'skimmed', 'reading', 'rereading'))
    LIMIT 18
  LOOP
    i := i + 1;
    INSERT INTO user_book_status (user_id, book_id, status, started_at, finished_at, updated_at)
    VALUES (
      v_uid, v_book_id, 'read',
      date_trunc('year', current_date) + ((i * 14 - 10) * interval '1 day'),
      date_trunc('year', current_date) + (i * 14 * interval '1 day'),
      now()
    )
    ON CONFLICT (user_id, book_id) DO UPDATE
      SET status = 'read',
          started_at = LEAST(
            COALESCE(user_book_status.started_at, EXCLUDED.started_at),
            COALESCE(user_book_status.finished_at, EXCLUDED.finished_at, EXCLUDED.started_at)
          ),
          finished_at = GREATEST(
            COALESCE(user_book_status.finished_at, EXCLUDED.finished_at),
            LEAST(
              COALESCE(user_book_status.started_at, EXCLUDED.started_at),
              COALESCE(user_book_status.finished_at, EXCLUDED.finished_at, EXCLUDED.started_at)
            )
          ),
          updated_at = EXCLUDED.updated_at;
  END LOOP;
  RAISE NOTICE 'Year Projection: marked % books as read this year', i;

  -- ─── WIDGET 5: Neglected Gems ──────────────────────────────────────────────
  -- Need books with bm.rating >= 8 that are NOT read by this user.
  -- Set high ratings on some unread books and ensure they have no 'read' status.
  i := 0;
  FOR v_book_id IN
    SELECT b.id
    FROM books b
    JOIN book_metadata bm ON bm.book_id = b.id
    LEFT JOIN user_book_status ubs ON ubs.book_id = b.id AND ubs.user_id = v_uid
    WHERE b.library_id = v_lib_id AND b.status = 'present'
      AND (ubs.status IS NULL OR ubs.status NOT IN ('read', 'skimmed'))
    LIMIT 10
  LOOP
    i := i + 1;
    -- Give them a high rating (8, 9, or 10)
    UPDATE book_metadata SET rating = 8 + (i % 3) WHERE book_id = v_book_id AND (rating IS NULL OR rating < 8);
    -- Set as want_to_read so they appear as "neglected"
    INSERT INTO user_book_status (user_id, book_id, status, started_at, updated_at)
    VALUES (v_uid, v_book_id, 'want_to_read', now() - (i * 30 * interval '1 day'), now())
    ON CONFLICT (user_id, book_id) DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Neglected Gems: set high ratings + want_to_read on % books', i;

  -- ─── WIDGET 6: Reading DNA ─────────────────────────────────────────────────
  -- Needs: many books read (already done above), genres, authors.
  -- Make sure genres are mapped. Check book_genres / book_authors are populated.
  -- (They come from metadata import; we just ensure enough 'read' books exist.)
  RAISE NOTICE 'Reading DNA: relies on book_genres/book_authors + read books (already seeded)';

  -- ─── WIDGET 7: The Long Wait ───────────────────────────────────────────────
  -- Need 1+ book with status = 'want_to_read' added a long time ago.
  SELECT b.id INTO v_book_id
  FROM books b
  LEFT JOIN user_book_status ubs ON ubs.book_id = b.id AND ubs.user_id = v_uid
  WHERE b.library_id = v_lib_id AND b.status = 'present'
    AND ubs.book_id IS NULL
  LIMIT 1;

  IF v_book_id IS NOT NULL THEN
    INSERT INTO user_book_status (user_id, book_id, status, started_at, updated_at)
    VALUES (v_uid, v_book_id, 'want_to_read', now() - interval '730 days', now())
    ON CONFLICT (user_id, book_id) DO UPDATE
      SET status = 'want_to_read',
          started_at = LEAST(user_book_status.started_at, EXCLUDED.started_at),
          updated_at = EXCLUDED.updated_at
      WHERE user_book_status.status NOT IN ('read', 'skimmed', 'reading', 'rereading');
    RAISE NOTICE 'Long Wait: marked book_id=% as want_to_read 730 days ago', v_book_id;
  END IF;

  -- ─── WIDGET 8: Diversity Score ─────────────────────────────────────────────
  -- Relies on read books having genres, authors, languages.
  -- Ensure book_metadata has language populated for some read books.
  UPDATE book_metadata bm
  SET language = (ARRAY['en','fr','de','es','ja','pt'])[1 + (bm.book_id % 6)]
  WHERE bm.book_id IN (
    SELECT ubs.book_id FROM user_book_status ubs
    WHERE ubs.user_id = v_uid AND ubs.status IN ('read','skimmed')
    LIMIT 20
  ) AND bm.language IS NULL;
  RAISE NOTICE 'Diversity Score: set languages on read books';

  -- ─── WIDGET 9: Reading Rhythm ─────────────────────────────────────────────
  -- Need user_reading_daily_stats for the last 28 days with realistic variance.
  -- Use a mix of active and rest days.
  FOR i IN 1..28 LOOP
    v_day := current_date - ((28 - i) * interval '1 day');
    v_secs := CASE
      WHEN (i % 7 = 0) THEN 0          -- one rest day per week
      WHEN (i % 7 = 6) THEN 4500       -- Saturday: long session
      ELSE 1800 + (i % 5) * 600        -- weekdays: 30-80 min
    END;
    IF v_secs > 0 THEN
      INSERT INTO user_reading_daily_stats (user_id, library_id, day, reading_seconds, progress_delta, sessions_count, updated_at)
      VALUES (v_uid, v_lib_id, v_day, v_secs, 0.01 + (i % 6) * 0.008, 1 + (i % 3), now())
      ON CONFLICT (user_id, library_id, day) DO UPDATE
        SET reading_seconds = GREATEST(user_reading_daily_stats.reading_seconds, EXCLUDED.reading_seconds),
            sessions_count  = GREATEST(user_reading_daily_stats.sessions_count, EXCLUDED.sessions_count),
            updated_at      = EXCLUDED.updated_at;
    END IF;
  END LOOP;
  RAISE NOTICE 'Reading Rhythm: upserted 28-day daily stats';

  RAISE NOTICE '=== Widget seed complete for user_id=% ===', v_uid;
END;
\$\$;

EOSQL

echo "Done."
