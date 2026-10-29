-- Since 3.5.0 metadata editing needs the Editor or Owner role on the book's library as well as the
-- Edit metadata permission. Every existing grant was Viewer, so the upgrade silently took editing
-- away from each non-superuser who held Edit metadata (issue 1902). Restore it on book libraries
-- for the accounts the upgrade left unable to edit anywhere. An account that already holds Editor
-- or Owner on some book library was set up under the new rules, so its Viewer grants are deliberate.
UPDATE "user_library_access" AS "access"
SET "access_level" = 'editor'
FROM "libraries", "users"
WHERE "libraries"."id" = "access"."library_id"
  AND "libraries"."type" = 'books'
  AND "users"."id" = "access"."user_id"
  AND "users"."is_superuser" = false
  AND "access"."access_level" = 'viewer'
  AND EXISTS (
    SELECT 1 FROM "user_permissions"
    WHERE "user_permissions"."user_id" = "access"."user_id"
      AND "user_permissions"."permission_name" = 'library_edit_metadata'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "user_library_access" AS "editing"
    INNER JOIN "libraries" AS "editing_library" ON "editing_library"."id" = "editing"."library_id"
    WHERE "editing"."user_id" = "access"."user_id"
      AND "editing_library"."type" = 'books'
      AND "editing"."access_level" IN ('editor', 'owner')
  );
