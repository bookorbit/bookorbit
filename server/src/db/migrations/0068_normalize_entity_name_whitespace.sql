-- Entity names written before whitespace normalization existed can hold a non-breaking space,
-- a tab, a newline or a doubled space. HTML collapses all of those, so the name looks correct in
-- the UI while `name ILIKE '%typed term%'` never matches it. Collapse the stored names to the
-- form normalizeMetadataTextSql() produces, merging rows that collide once collapsed.
--
-- Grouping is on the whitespace-collapsed name only, not lowercased: search is already
-- case-insensitive, so case variants are not part of this defect and are left alone.

-- ── authors ──────────────────────────────────────────────────────────────────
WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM authors
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id, canonical_id FROM canonical WHERE id <> canonical_id
)
INSERT INTO book_authors (book_id, author_id, display_order)
SELECT DISTINCT ON (ba.book_id, d.canonical_id) ba.book_id, d.canonical_id, ba.display_order
FROM book_authors ba
JOIN duplicates d ON d.duplicate_id = ba.author_id
ORDER BY ba.book_id, d.canonical_id, ba.display_order ASC
ON CONFLICT (book_id, author_id) DO NOTHING;--> statement-breakpoint

WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM authors
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id FROM canonical WHERE id <> canonical_id
)
DELETE FROM book_authors ba USING duplicates d WHERE ba.author_id = d.duplicate_id;--> statement-breakpoint

-- author_enrichment_queue cascades; a merged-away author simply loses its queued entry.
WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM authors
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id FROM canonical WHERE id <> canonical_id
)
DELETE FROM authors a USING duplicates d WHERE a.id = d.duplicate_id;--> statement-breakpoint

UPDATE authors SET
  name = btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')),
  sort_name = NULLIF(btrim(regexp_replace(replace(COALESCE(sort_name, ''), chr(160), ' '), '[[:space:]]+', ' ', 'g')), '')
WHERE btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) <> ''
  AND (
    name <> btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g'))
    OR sort_name IS DISTINCT FROM NULLIF(btrim(regexp_replace(replace(COALESCE(sort_name, ''), chr(160), ' '), '[[:space:]]+', ' ', 'g')), '')
  );--> statement-breakpoint

-- ── narrators ────────────────────────────────────────────────────────────────
WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM narrators
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id, canonical_id FROM canonical WHERE id <> canonical_id
)
INSERT INTO book_narrators (book_id, narrator_id, display_order)
SELECT DISTINCT ON (bn.book_id, d.canonical_id) bn.book_id, d.canonical_id, bn.display_order
FROM book_narrators bn
JOIN duplicates d ON d.duplicate_id = bn.narrator_id
ORDER BY bn.book_id, d.canonical_id, bn.display_order ASC
ON CONFLICT (book_id, narrator_id) DO NOTHING;--> statement-breakpoint

WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM narrators
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id FROM canonical WHERE id <> canonical_id
)
DELETE FROM book_narrators bn USING duplicates d WHERE bn.narrator_id = d.duplicate_id;--> statement-breakpoint

WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM narrators
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id FROM canonical WHERE id <> canonical_id
)
DELETE FROM narrators n USING duplicates d WHERE n.id = d.duplicate_id;--> statement-breakpoint

UPDATE narrators SET
  name = btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')),
  sort_name = NULLIF(btrim(regexp_replace(replace(COALESCE(sort_name, ''), chr(160), ' '), '[[:space:]]+', ' ', 'g')), '')
WHERE btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) <> ''
  AND (
    name <> btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g'))
    OR sort_name IS DISTINCT FROM NULLIF(btrim(regexp_replace(replace(COALESCE(sort_name, ''), chr(160), ' '), '[[:space:]]+', ' ', 'g')), '')
  );--> statement-breakpoint

-- ── genres ───────────────────────────────────────────────────────────────────
WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM genres
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id, canonical_id FROM canonical WHERE id <> canonical_id
)
INSERT INTO book_genres (book_id, genre_id)
SELECT DISTINCT bg.book_id, d.canonical_id
FROM book_genres bg
JOIN duplicates d ON d.duplicate_id = bg.genre_id
ON CONFLICT (book_id, genre_id) DO NOTHING;--> statement-breakpoint

WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM genres
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id, canonical_id FROM canonical WHERE id <> canonical_id
)
INSERT INTO user_content_filter_genres (user_id, filter_type, genre_id)
SELECT DISTINCT ucf.user_id, ucf.filter_type, d.canonical_id
FROM user_content_filter_genres ucf
JOIN duplicates d ON d.duplicate_id = ucf.genre_id
ON CONFLICT (user_id, filter_type, genre_id) DO NOTHING;--> statement-breakpoint

WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM genres
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id FROM canonical WHERE id <> canonical_id
)
DELETE FROM genres g USING duplicates d WHERE g.id = d.duplicate_id;--> statement-breakpoint

UPDATE genres SET name = btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g'))
WHERE name <> btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g'))
  AND btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) <> '';--> statement-breakpoint

-- ── tags ─────────────────────────────────────────────────────────────────────
WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM tags
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id, canonical_id FROM canonical WHERE id <> canonical_id
)
INSERT INTO book_tags (book_id, tag_id)
SELECT DISTINCT bt.book_id, d.canonical_id
FROM book_tags bt
JOIN duplicates d ON d.duplicate_id = bt.tag_id
ON CONFLICT (book_id, tag_id) DO NOTHING;--> statement-breakpoint

WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM tags
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id, canonical_id FROM canonical WHERE id <> canonical_id
)
INSERT INTO user_content_filter_tags (user_id, filter_type, tag_id)
SELECT DISTINCT ucf.user_id, ucf.filter_type, d.canonical_id
FROM user_content_filter_tags ucf
JOIN duplicates d ON d.duplicate_id = ucf.tag_id
ON CONFLICT (user_id, filter_type, tag_id) DO NOTHING;--> statement-breakpoint

WITH normalized AS (
  SELECT id, name, btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) AS norm
  FROM tags
), canonical AS (
  SELECT id, first_value(id) OVER (PARTITION BY norm ORDER BY (name = norm) DESC, id ASC) AS canonical_id
  FROM normalized WHERE norm <> ''
), duplicates AS (
  SELECT id AS duplicate_id FROM canonical WHERE id <> canonical_id
)
DELETE FROM tags t USING duplicates d WHERE t.id = d.duplicate_id;--> statement-breakpoint

UPDATE tags SET name = btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g'))
WHERE name <> btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g'))
  AND btrim(regexp_replace(replace(name, chr(160), ' '), '[[:space:]]+', ' ', 'g')) <> '';--> statement-breakpoint

-- Merging author rows and rewriting their names invalidates the denormalized sort key on books.
UPDATE books b SET primary_author_sort_name = (
  SELECT NULLIF(btrim(COALESCE(a.sort_name, a.name)), '')
  FROM book_authors ba INNER JOIN authors a ON a.id = ba.author_id
  WHERE ba.book_id = b.id
  ORDER BY ba.display_order ASC, ba.author_id ASC
  LIMIT 1
)
WHERE b.primary_author_sort_name IS DISTINCT FROM (
  SELECT NULLIF(btrim(COALESCE(a.sort_name, a.name)), '')
  FROM book_authors ba INNER JOIN authors a ON a.id = ba.author_id
  WHERE ba.book_id = b.id
  ORDER BY ba.display_order ASC, ba.author_id ASC
  LIMIT 1
);
