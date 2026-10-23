--[[--
The old four-slot dashboard setting, and how a shelf's source is fetched.

The widget board replaced the four configurable slots. Their stored value is
still read once, so shelves a reader picked through a catalog list (one
library, collection, SmartScope, author or series) carry over onto the board;
see BoardEdit:boardMigrateLegacyShelves. The source routing below is what
every board shelf uses to fetch its books.
]]

local DashboardSections = {}

local PARAM_KEYS = { "libraryId", "collectionId", "smartScopeId", "author", "seriesId", "series", "sort" }

DashboardSections.SETTING_KEY = "catalog_dashboard_sections"
DashboardSections.DEFAULT_TYPE = "random"
DashboardSections.SCHEMA_VERSION = 2
DashboardSections.LEGACY_SCHEMA_VERSION = 1
DashboardSections.SLOT_COUNT = 4
DashboardSections.DEFAULT_SLOTS = {
    { type = "stats" },
    { type = "continue-reading" },
    { type = "random" },
    { type = "browse" },
}

-- Every type the old slots could hold. Anything else degrades to Discover.
local VALID_TYPES = {}
for _, section_type in ipairs({
    "stats", "continue-reading", "random", "browse", "highlight", "recently-added", "in-progress",
    "want-to-read", "up-next-in-series", "libraries", "authors", "series", "collections", "smart-scopes",
}) do
    VALID_TYPES[section_type] = true
end

-- Sources served by the dashboard-section endpoint rather than the catalog
-- books endpoint; only used when the server advertises the capability.
DashboardSections.SECTION_ENDPOINT_CAPABILITY = "catalogDashboardSections"

local SECTION_ENDPOINT_TYPES = {
    ["want-to-read"] = true,
    ["up-next-in-series"] = true,
}

function DashboardSections.usesSectionEndpoint(section_type)
    return SECTION_ENDPOINT_TYPES[section_type] == true
end

function DashboardSections.isValid(section_type)
    return VALID_TYPES[section_type] == true
end

local CATALOG_SELECTORS = {
    ["libraries"] = true,
    ["authors"] = true,
    ["series"] = true,
    ["collections"] = true,
    ["smart-scopes"] = true,
}

function DashboardSections.isCatalogSelector(section_type)
    return CATALOG_SELECTORS[section_type] == true
end

function DashboardSections.defaultConfig(index)
    local config = (index and DashboardSections.DEFAULT_SLOTS[index]) or { type = DashboardSections.DEFAULT_TYPE }
    return { type = config.type }
end

-- An unusable or obsolete entry degrades to Discover rather than being dropped.
function DashboardSections.normalizeEntry(value)
    if type(value) ~= "table" or not DashboardSections.isValid(value.type) then
        return DashboardSections.defaultConfig()
    end
    local entry = { type = value.type }
    if DashboardSections.isCatalogSelector(value.type) then
        if type(value.sourceName) ~= "string" or value.sourceName == "" or type(value.params) ~= "table" then
            return DashboardSections.defaultConfig()
        end
        entry.sourceName = value.sourceName
        entry.params = {}
        for _, key in ipairs(PARAM_KEYS) do
            if value.params[key] ~= nil then entry.params[key] = value.params[key] end
        end
    end
    return entry
end

function DashboardSections.normalize(value)
    local normalized = { schemaVersion = DashboardSections.SCHEMA_VERSION }
    if type(value) ~= "table" or #value == 0 then
        for index = 1, DashboardSections.SLOT_COUNT do
            normalized[index] = DashboardSections.defaultConfig(index)
        end
        return normalized
    end

    -- Releases before the four-slot dashboard stored the one or two configurable
    -- rows that sat below Continue reading, and wrote no schema marker at all.
    -- An untagged list is therefore that older shape, not a short current one:
    -- reading it positionally would drop Stats and duplicate Discover.
    if value.schemaVersion == nil or value.schemaVersion == DashboardSections.LEGACY_SCHEMA_VERSION then
        normalized[1] = DashboardSections.defaultConfig(1)
        normalized[2] = DashboardSections.defaultConfig(2)
        normalized[3] = DashboardSections.normalizeEntry(value[1])
        normalized[4] = value[2] and DashboardSections.normalizeEntry(value[2]) or DashboardSections.defaultConfig(4)
        return normalized
    end

    for index = 1, DashboardSections.SLOT_COUNT do
        normalized[index] = value[index] and DashboardSections.normalizeEntry(value[index]) or DashboardSections.defaultConfig(index)
    end
    return normalized
end

return DashboardSections
