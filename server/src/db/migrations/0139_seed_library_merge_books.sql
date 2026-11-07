-- Merging books moves files and deletes the merged-away records, so it starts with the accounts
-- that could already do both halves by hand: delete books and edit their metadata.
INSERT INTO "user_permissions" ("user_id", "permission_name")
SELECT "deleting"."user_id", 'library_merge_books'
FROM "user_permissions" AS "deleting"
WHERE "deleting"."permission_name" = 'library_delete_books'
  AND EXISTS (
    SELECT 1 FROM "user_permissions" AS "editing"
    WHERE "editing"."user_id" = "deleting"."user_id"
      AND "editing"."permission_name" = 'library_edit_metadata'
  )
ON CONFLICT DO NOTHING;
