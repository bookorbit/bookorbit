package.loaded["gettext"] = function(text)
    return text
end

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
assertEqual(DashboardSections.normalizeEntry({ type = "want-to-read" }).type, "random", "an obsolete pseudo-source degrades to Discover")
assertEqual(DashboardSections.normalizeEntry({ type = "authors" }).type, "random", "an unselected catalog type degrades to Discover")

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

local migrated_one = DashboardSections.normalize({ { type = "recently-added" } })
assertEqual(migrated_one[1].type, "stats", "one-row migration restores Stats")
assertEqual(migrated_one[2].type, "continue-reading", "one-row migration restores Continue reading")
assertEqual(migrated_one[3].type, "recently-added", "one-row migration places the old row in slot 3")
assertEqual(migrated_one[4].type, "browse", "one-row migration restores Browse")

local migrated_two = DashboardSections.normalize({ { type = "want-to-read" }, author_source })
assertEqual(migrated_two[3].type, "random", "an obsolete old row migrates safely to Discover")
assertEqual(migrated_two[4].type, "authors", "a selected catalog source survives migration")

local repeated = DashboardSections.normalize({
    { type = "stats" },
    { type = "stats" },
    { type = "browse" },
    { type = "browse" },
})
assertEqual(repeated[1].type, "stats", "slot types may repeat")
assertEqual(repeated[2].type, "stats", "a second Stats slot is retained")
assertEqual(repeated[3].type, "browse", "a Browse slot is retained")
assertEqual(repeated[4].type, "browse", "a repeated Browse slot is retained")

local stored = DashboardSections.storeAt({
    [DashboardSections.SETTING_KEY] = defaults,
}, 2, author_source)
assertEqual(stored[2].type, "authors", "storeAt updates the requested slot")
assertEqual(stored[1].type, "stats", "storeAt leaves other slots unchanged")
assertNotSame(stored[2].params, author_source.params, "storeAt does not retain caller-owned parameter tables")

assertEqual(DashboardSections.signature({ type = "recently-added" }), "recently-added", "a source signs as itself")
assertEqual(DashboardSections.signature(author_source), "authors:author=Ursula K. Le Guin:sort=title", "catalog signatures include stable allowed filters")
assertEqual(DashboardSections.headerText(author_source), "Ursula K. Le Guin", "a selected shelf is titled by its entry")
assertEqual(DashboardSections.headerText({ type = "authors", sourceName = "" }), "Authors", "an empty source name falls back to the source label")
assertEqual(DashboardSections.isBookSource("authors"), true, "a selected author is a book shelf source")
assertEqual(DashboardSections.isBookSource("browse"), false, "Browse is not a book shelf source")
assertEqual(DashboardSections.isCatalogSelector("series"), true, "Series requires one more selection level")
assertEqual(DashboardSections.isCatalogSelector("random"), false, "Discover is directly selectable")

print("bookorbit_dashboard_sections_test.lua: ok")
