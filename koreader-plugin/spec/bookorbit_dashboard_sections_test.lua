-- The old four-slot setting is still read once, so shelves picked through a
-- catalog list carry over onto the widget board.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local DashboardSections = require("bookorbit_dashboard_sections")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function assertNotSame(actual, expected, label)
    if actual == expected then
        error(label .. ": expected distinct tables")
    end
end

local author_source = {
    type = "authors",
    sourceName = "Ursula K. Le Guin",
    params = {
        author = "Ursula K. Le Guin",
        sort = "title",
        ignored = "not persisted",
    },
}

assertEqual(DashboardSections.normalizeEntry(nil).type, "random", "a missing entry degrades to Discover")
assertEqual(DashboardSections.normalizeEntry({ type = "not-a-source" }).type, "random", "an unknown type degrades to Discover")
assertEqual(DashboardSections.normalizeEntry({ type = "smart-scope" }).type, "random", "an obsolete pseudo-source degrades to Discover")
assertEqual(DashboardSections.normalizeEntry({ type = "authors" }).type, "random", "an unselected catalog type degrades to Discover")

-- Server-composed sources and the highlight card were slot types too.
assertEqual(DashboardSections.normalizeEntry({ type = "want-to-read" }).type, "want-to-read", "Want to read was a slot source")
assertEqual(DashboardSections.normalizeEntry({ type = "up-next-in-series" }).type, "up-next-in-series", "Up next in series is a supported source")
assertEqual(DashboardSections.normalizeEntry({ type = "highlight" }).type, "highlight", "the highlight card was a slot")
assertEqual(DashboardSections.usesSectionEndpoint("want-to-read"), true, "Want to read is served by the section endpoint")
assertEqual(DashboardSections.usesSectionEndpoint("up-next-in-series"), true, "Up next in series is served by the section endpoint")
assertEqual(DashboardSections.usesSectionEndpoint("recently-added"), false, "catalog-books sources skip the section endpoint")

local normalized_author = DashboardSections.normalizeEntry(author_source)
assertEqual(normalized_author.type, "authors", "a selected author source is kept")
assertEqual(normalized_author.sourceName, "Ursula K. Le Guin", "a selected author keeps its display name")
assertEqual(normalized_author.params.author, "Ursula K. Le Guin", "a selected author keeps its filter")
assertEqual(normalized_author.params.sort, "title", "a selected author keeps its sort")
assertEqual(normalized_author.params.ignored, nil, "unknown catalog parameters are discarded")
assertNotSame(normalized_author.params, author_source.params, "normalization defensively copies catalog parameters")

local defaults = DashboardSections.normalize(nil)
assertEqual(#defaults, 4, "the dashboard always has four slots")
assertEqual(defaults[1].type, "stats", "slot 1 defaults to Stats")
assertEqual(defaults[2].type, "continue-reading", "slot 2 defaults to Continue reading")
assertEqual(defaults[3].type, "random", "slot 3 defaults to Discover")
assertEqual(defaults[4].type, "browse", "slot 4 defaults to Browse")
assertNotSame(defaults[1], DashboardSections.DEFAULT_SLOTS[1], "default normalization returns copies")

-- What releases before the four-slot dashboard actually wrote to the device:
-- a bare list of the configurable rows, with no schema marker at all. Reading
-- one positionally would drop Stats and leave Discover in two slots, so an
-- untagged list has to be recognised as the old shape.
local migrated_one = DashboardSections.normalize({ { type = "recently-added" } })
assertEqual(migrated_one[1].type, "stats", "one-row migration restores Stats")
assertEqual(migrated_one[2].type, "continue-reading", "one-row migration restores Continue reading")
assertEqual(migrated_one[3].type, "recently-added", "one-row migration places the old row in slot 3")
assertEqual(migrated_one[4].type, "browse", "one-row migration restores Browse")
assertEqual(migrated_one.schemaVersion, DashboardSections.SCHEMA_VERSION, "normalization writes the current schema marker")

local migrated_scope = DashboardSections.normalize({
    { type = "smart-scope", smartScopeId = 4, smartScopeName = "Sci-fi" },
})
assertEqual(migrated_scope[1].type, "stats", "a stored SmartScope row still restores Stats")
assertEqual(migrated_scope[3].type, "random", "an obsolete SmartScope row degrades to Discover in its own slot")
assertEqual(migrated_scope[4].type, "browse", "a stored SmartScope row still restores Browse")

local migrated_two = DashboardSections.normalize({
    { type = "want-to-read" },
    author_source,
    schemaVersion = DashboardSections.LEGACY_SCHEMA_VERSION,
})
assertEqual(migrated_two[3].type, "want-to-read", "a legacy Want to read row migrates to the supported source")
assertEqual(migrated_two[4].type, "authors", "a selected catalog source survives migration")

local current = DashboardSections.normalize({
    { type = "recently-added" },
    schemaVersion = DashboardSections.SCHEMA_VERSION,
})
assertEqual(current[1].type, "recently-added", "a tagged current list is read positionally")
assertEqual(current[2].type, "continue-reading", "missing current slots use their positional defaults")

local repeated = DashboardSections.normalize({
    { type = "stats" },
    { type = "stats" },
    { type = "browse" },
    { type = "browse" },
    schemaVersion = DashboardSections.SCHEMA_VERSION,
})
assertEqual(repeated[1].type, "stats", "slot types may repeat")
assertEqual(repeated[2].type, "stats", "a second Stats slot is retained")
assertEqual(repeated[3].type, "browse", "a Browse slot is retained")
assertEqual(repeated[4].type, "browse", "a repeated Browse slot is retained")

assertEqual(DashboardSections.isCatalogSelector("series"), true, "Series requires one more selection level")
assertEqual(DashboardSections.isCatalogSelector("random"), false, "Discover is directly selectable")

print("bookorbit_dashboard_sections_test.lua: ok")
