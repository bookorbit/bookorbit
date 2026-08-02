--[[--
Registry for the four configurable dashboard slots.

Each source keeps its native renderer: Stats is a strip, Continue reading is a
hero row, book sources are cover grids, and Browse is the compact action list.
A book source is fully described by its type plus, for the sources picked
through a catalog list, the filter that was selected. The stored value is an
ordered list matching the four dashboard slots.

The selected entry's name is cached alongside its filter purely so the settings
menu and the section header can label the slot without a request.
]]

local _ = require("gettext")

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

-- Order here mirrors the destinations exposed by the dashboard Browse block.
DashboardSections.TYPES = {
    "stats",
    "continue-reading",
    "random",
    "browse",
    "highlight",
    "recently-added",
    "in-progress",
    "want-to-read",
    "up-next-in-series",
    "libraries",
    "authors",
    "series",
    "collections",
    "smart-scopes",
}

-- Sources served by the dashboard-section endpoint rather than the catalog
-- books endpoint; only offered when the server advertises the capability.
DashboardSections.SECTION_ENDPOINT_CAPABILITY = "catalogDashboardSections"

local SECTION_ENDPOINT_TYPES = {
    ["want-to-read"] = true,
    ["up-next-in-series"] = true,
}

function DashboardSections.usesSectionEndpoint(section_type)
    return SECTION_ENDPOINT_TYPES[section_type] == true
end

local LABELS = {
    ["stats"] = function() return _("Stats") end,
    ["continue-reading"] = function() return _("Continue reading") end,
    ["random"] = function() return _("Discover") end,
    ["browse"] = function() return _("Browse") end,
    ["highlight"] = function() return _("Highlight of the day") end,
    ["recently-added"] = function() return _("Recently added") end,
    ["in-progress"] = function() return _("In progress") end,
    ["want-to-read"] = function() return _("Want to read") end,
    ["up-next-in-series"] = function() return _("Up next in series") end,
    ["libraries"] = function() return _("Libraries") end,
    ["authors"] = function() return _("Authors") end,
    ["series"] = function() return _("Series") end,
    ["collections"] = function() return _("Collections") end,
    ["smart-scopes"] = function() return _("SmartScopes") end,
}

local HELP_TEXT = {
    ["stats"] = function() return _("Your reading summary shown as a compact horizontal strip.") end,
    ["continue-reading"] = function() return _("Books currently in progress, shown as the dashboard hero row.") end,
    ["random"] = function() return _("A random selection from your whole library, reshuffled with the button in the section header.") end,
    ["browse"] = function() return _("Dashboard shortcuts for libraries, collections, SmartScopes, authors, series, and books.") end,
    ["highlight"] = function() return _("One highlight from your library, picked fresh every day.") end,
    ["recently-added"] = function() return _("The books most recently added to your library.") end,
    ["in-progress"] = function() return _("The catalog view for books currently in progress.") end,
    ["want-to-read"] = function() return _("Books marked Want to read. Needs a server that supports dashboard sections.") end,
    ["up-next-in-series"] = function() return _("The next unread book of each series you are reading. Needs a server that supports dashboard sections.") end,
    ["libraries"] = function() return _("The existing Libraries catalog, including its normal navigation and back button.") end,
    ["authors"] = function() return _("The existing Authors catalog, including its normal pagination and back button.") end,
    ["series"] = function() return _("The existing Series catalog, including its normal pagination and back button.") end,
    ["collections"] = function() return _("The existing Collections catalog and its normal back navigation.") end,
    ["smart-scopes"] = function() return _("The existing SmartScopes catalog. Choose a scope there rather than configuring one directly on the dashboard.") end,
}

function DashboardSections.isValid(section_type)
    return LABELS[section_type] ~= nil
end

function DashboardSections.label(section_type)
    local label = LABELS[section_type]
    return label and label() or LABELS[DashboardSections.DEFAULT_TYPE]()
end

function DashboardSections.helpText(section_type)
    local help = HELP_TEXT[section_type]
    return help and help() or nil
end

local BOOK_SOURCES = {
    ["random"] = true,
    ["recently-added"] = true,
    ["in-progress"] = true,
    ["want-to-read"] = true,
    ["up-next-in-series"] = true,
    ["libraries"] = true,
    ["authors"] = true,
    ["series"] = true,
    ["collections"] = true,
    ["smart-scopes"] = true,
}

local CATALOG_SELECTORS = {
    ["libraries"] = true,
    ["authors"] = true,
    ["series"] = true,
    ["collections"] = true,
    ["smart-scopes"] = true,
}

function DashboardSections.isBookSource(section_type)
    return BOOK_SOURCES[section_type] == true
end

function DashboardSections.isCatalogSelector(section_type)
    return CATALOG_SELECTORS[section_type] == true
end

function DashboardSections.headerText(config)
    if config and type(config.sourceName) == "string" and config.sourceName ~= "" then
        return config.sourceName
    end
    return DashboardSections.label(config and config.type)
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

function DashboardSections.at(settings, index)
    index = index or 1
    local stored = settings and settings[DashboardSections.SETTING_KEY]
    local sections = DashboardSections.normalize(stored)
    return sections[index] or DashboardSections.defaultConfig(index)
end

function DashboardSections.storeAt(settings, index, config)
    index = math.max(1, math.min(DashboardSections.SLOT_COUNT, tonumber(index) or 1))
    local stored = settings and settings[DashboardSections.SETTING_KEY]
    local sections = DashboardSections.normalize(stored)
    sections[index] = DashboardSections.normalizeEntry(config)
    sections.schemaVersion = DashboardSections.SCHEMA_VERSION
    return sections
end

-- Identifies which section a cached dashboard body was fetched for, so a body
-- cached under a different choice is not mistaken for the current one.
function DashboardSections.signature(config)
    config = DashboardSections.normalizeEntry(config)
    if DashboardSections.isCatalogSelector(config.type) then
        local parts = { config.type }
        for _, key in ipairs(PARAM_KEYS) do
            if config.params[key] ~= nil then table.insert(parts, key .. "=" .. tostring(config.params[key])) end
        end
        return table.concat(parts, ":")
    end
    return config.type
end

function DashboardSections.settingsSignature(settings)
    local parts = {}
    for index = 1, DashboardSections.SLOT_COUNT do
        parts[index] = DashboardSections.signature(DashboardSections.at(settings, index))
    end
    return table.concat(parts, "|")
end

return DashboardSections
