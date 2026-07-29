--[[--
Registry for the configurable dashboard row below Continue reading.

Every source renders as the same row of cover cards, so a section is fully
described by its type plus, for a SmartScope, which scope to run. The stored
value is an ordered list even though only the first entry is rendered today:
that way a later release can show more than one configurable row without
rewriting settings already on the device.

The SmartScope name is cached alongside the id purely so the settings menu can
label the row without a request. It is never sent to the server.
]]

local _ = require("gettext")

local DashboardSections = {}

DashboardSections.SETTING_KEY = "catalog_dashboard_sections"
DashboardSections.CAPABILITY = "catalogDashboardSections"
DashboardSections.DEFAULT_TYPE = "random"

-- Order here is the order the picker lists them in.
DashboardSections.TYPES = {
    "random",
    "recently-added",
    "want-to-read",
    "up-next-in-series",
    "smart-scope",
}

local LABELS = {
    ["random"] = function() return _("Discover") end,
    ["recently-added"] = function() return _("Recently added") end,
    ["want-to-read"] = function() return _("Want to read") end,
    ["up-next-in-series"] = function() return _("Up next in series") end,
    ["smart-scope"] = function() return _("SmartScope") end,
}

local HELP_TEXT = {
    ["random"] = function() return _("A random selection from your whole library, reshuffled with the button in the section header.") end,
    ["recently-added"] = function() return _("The books most recently added to your library.") end,
    ["want-to-read"] = function() return _("Books you marked as want to read.") end,
    ["up-next-in-series"] = function() return _("The next unread book in each series you have already started.") end,
    ["smart-scope"] = function() return _("Books matching a SmartScope you saved in BookOrbit.") end,
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

-- What the section header shows. A SmartScope row is named after the scope
-- itself; the generic label would tell the reader nothing.
function DashboardSections.headerText(config)
    config = config or {}
    if config.type == "smart-scope" and type(config.smartScopeName) == "string" and config.smartScopeName ~= "" then
        return config.smartScopeName
    end
    return DashboardSections.label(config.type)
end

function DashboardSections.defaultConfig()
    return { type = DashboardSections.DEFAULT_TYPE }
end

-- An unusable entry degrades to Discover rather than being dropped: the slot
-- always renders something, so a config written by a newer plugin, or a
-- SmartScope deleted on the server, still leaves a working dashboard.
function DashboardSections.normalizeEntry(value)
    if type(value) ~= "table" or not DashboardSections.isValid(value.type) then
        return DashboardSections.defaultConfig()
    end
    if value.type ~= "smart-scope" then
        return { type = value.type }
    end
    local scope_id = tonumber(value.smartScopeId)
    if not scope_id or scope_id <= 0 then
        return DashboardSections.defaultConfig()
    end
    local entry = { type = "smart-scope", smartScopeId = math.floor(scope_id) }
    if type(value.smartScopeName) == "string" and value.smartScopeName ~= "" then
        entry.smartScopeName = value.smartScopeName
    end
    return entry
end

function DashboardSections.normalize(value)
    if type(value) ~= "table" or #value == 0 then
        return { DashboardSections.defaultConfig() }
    end
    local normalized = {}
    for _index, entry in ipairs(value) do
        table.insert(normalized, DashboardSections.normalizeEntry(entry))
    end
    return normalized
end

function DashboardSections.at(settings, index)
    local stored = settings and settings[DashboardSections.SETTING_KEY]
    local sections = DashboardSections.normalize(stored)
    return sections[index or 1] or DashboardSections.defaultConfig()
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
    if config.type == "smart-scope" then
        return "smart-scope:" .. tostring(config.smartScopeId)
    end
    return config.type
end

return DashboardSections
