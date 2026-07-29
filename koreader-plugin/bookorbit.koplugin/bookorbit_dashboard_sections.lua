--[[--
Registry for the four configurable dashboard slots.

Each source keeps its native renderer: Stats is a strip, Continue reading is a
hero row, book sources are cover grids, and Browse is the compact action list.
A book source is fully described by its type plus, for a SmartScope, which scope
to run. The stored value is an ordered list matching the four dashboard slots.

The SmartScope name is cached alongside the id purely so the settings menu can
label the row without a request. It is never sent to the server.
]]

local _ = require("gettext")

local DashboardSections = {}

DashboardSections.SETTING_KEY = "catalog_dashboard_sections"
DashboardSections.CAPABILITY = "catalogDashboardSections"
DashboardSections.DEFAULT_TYPE = "random"
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
    "recently-added",
    "in-progress",
    "libraries",
    "authors",
    "series",
    "collections",
    "smart-scopes",
}

local LABELS = {
    ["stats"] = function() return _("Stats") end,
    ["continue-reading"] = function() return _("Continue reading") end,
    ["random"] = function() return _("Discover") end,
    ["browse"] = function() return _("Browse") end,
    ["recently-added"] = function() return _("Recently added") end,
    ["in-progress"] = function() return _("In progress") end,
    ["all-books"] = function() return _("All Books") end,
    ["on-device"] = function() return _("On device") end,
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
    ["recently-added"] = function() return _("The books most recently added to your library.") end,
    ["in-progress"] = function() return _("The catalog view for books currently in progress.") end,
    ["all-books"] = function() return _("The complete catalog sorted by title.") end,
    ["on-device"] = function() return _("Books linked to files on this device.") end,
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
    local config = DashboardSections.DEFAULT_SLOTS[index or 3] or { type = DashboardSections.DEFAULT_TYPE }
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
        for _, key in ipairs({ "libraryId", "collectionId", "smartScopeId", "author", "seriesId", "series", "sort" }) do
            if value.params[key] ~= nil then entry.params[key] = value.params[key] end
        end
    end
    return entry
end

function DashboardSections.normalize(value)
    if type(value) ~= "table" or #value == 0 then
        local defaults = {}
        for index = 1, DashboardSections.SLOT_COUNT do
            defaults[index] = DashboardSections.defaultConfig(index)
        end
        return defaults
    end

    local normalized = {}
    local legacy_rows = #value <= 2
        and value[1] and value[1].type ~= "stats" and value[1].type ~= "continue-reading" and value[1].type ~= "browse"
    if legacy_rows then
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

function DashboardSections.primary(settings)
    return DashboardSections.at(settings, 1)
end

function DashboardSections.store(config)
    return { DashboardSections.normalizeEntry(config) }
end

function DashboardSections.storeAt(settings, index, config)
    local stored = settings and settings[DashboardSections.SETTING_KEY]
    local sections = DashboardSections.normalize(stored)
    while #sections < index do
        table.insert(sections, DashboardSections.defaultConfig())
    end
    sections[index] = DashboardSections.normalizeEntry(config)
    return sections
end

-- Identifies which section a cached dashboard body was fetched for, so a body
-- cached under a different choice is not mistaken for the current one.
function DashboardSections.signature(config)
    config = DashboardSections.normalizeEntry(config)
    if DashboardSections.isCatalogSelector(config.type) then
        local parts = { config.type }
        for _, key in ipairs({ "libraryId", "collectionId", "smartScopeId", "author", "seriesId", "series", "sort" }) do
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
