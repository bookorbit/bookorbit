-- A read-along EPUB's narration length was the sum of its SMIL clips, and a single clip that could
-- not be measured left it null. Storyteller 2.x writes such a clip at most audio track boundaries.
-- The parser now falls back to the package media:duration, so clear the check stamp on every file
-- it could not measure: the next library scan, or the book's detail page, inspects each one again.
UPDATE "book_files" SET "media_overlay_checked_at" = NULL WHERE "media_overlay_available" = true AND "media_overlay_duration_seconds" IS NULL;
