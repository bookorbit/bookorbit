local T = require("ffi/util").template
local _ = require("gettext")

local Config = {}

Config.SORTS = {
    { id = "title", text = _("Title") },
    { id = "author", text = _("Author") },
    { id = "recently_added", text = _("Recently added") },
    { id = "recently_updated", text = _("Recently updated") },
    { id = "recently_read", text = _("Recently read") },
    { id = "series", text = _("Series order") },
}

Config.SORT_LABELS = {
    title = _("Title"),
    author = _("Author"),
    recently_added = _("Recently added"),
    recently_updated = _("Recently updated"),
    recently_read = _("Recently read"),
    series = _("Series order"),
}

Config.SHELF_LIMIT = 12
Config.DEFAULT_SECTIONS = {
    { kind = "stats" },
    { kind = "continue" },
    { kind = "discover" },
    { kind = "browse" },
}

local KIND_LABELS = {
    stats = _("Stats"),
    continue = _("Continue reading"),
    discover = _("Discover"),
    browse = _("Browse"),
    books = _("All Books"),
    ["in-progress"] = _("In progress"),
    ["on-device"] = _("On device"),
    library = _("Library"),
    author = _("Author"),
    series = _("Series"),
    collection = _("Collection"),
    ["smart-scope"] = _("SmartScope"),
    off = _("Off"),
}

function Config.clone(value)
    if type(value) ~= "table" then return value end
    local copy = {}
    for key, item in pairs(value) do copy[key] = Config.clone(item) end
    return copy
end

function Config.sections(settings)
    local saved = settings and settings.catalog_dashboard_sections
    if type(saved) ~= "table" then return Config.clone(Config.DEFAULT_SECTIONS) end
    local sections = {}
    for index = 1, 4 do
        local section = saved[index]
        sections[index] = type(section) == "table" and Config.clone(section)
            or Config.clone(Config.DEFAULT_SECTIONS[index])
    end
    return sections
end

function Config.label(section)
    section = section or { kind = "off" }
    if section.title and section.title ~= "" then return section.title end
    return KIND_LABELS[section.kind] or _("Off")
end

function Config.summary(section)
    local label = Config.label(section)
    if section and Config.isShelf(section) then
        local sort = Config.SORT_LABELS[section.sort or Config.defaultSort(section)]
        if sort then return T(_("%1 — %2"), label, sort) end
    end
    return label
end

function Config.isShelf(section)
    local kind = section and section.kind
    return kind == "discover" or kind == "books" or kind == "in-progress"
        or kind == "on-device" or kind == "library" or kind == "author"
        or kind == "series" or kind == "collection" or kind == "smart-scope"
end

function Config.defaultSort(section)
    local kind = section and section.kind
    if kind == "in-progress" then return "recently_read" end
    if kind == "books" or kind == "on-device" or kind == "author" then return "title" end
    if kind == "series" then return "series" end
    return "recently_added"
end

function Config.bookParams(section, on_device_ids)
    section = section or {}
    local params = {
        page = 1,
        size = Config.SHELF_LIMIT,
        sort = section.sort or Config.defaultSort(section),
    }
    if section.kind == "in-progress" then
        params.readStatus = "reading"
    elseif section.kind == "on-device" then
        params.ids = on_device_ids
    elseif section.kind == "library" then
        params.libraryId = tonumber(section.id)
    elseif section.kind == "author" then
        params.author = section.id
    elseif section.kind == "series" then
        if section.seriesId then params.seriesId = tonumber(section.seriesId) else params.series = section.id end
    elseif section.kind == "collection" then
        params.collectionId = tonumber(section.id)
    elseif section.kind == "smart-scope" then
        params.smartScopeId = tonumber(section.id)
    end
    return params
end

function Config.targetKind(section_name)
    local map = {
        libraries = "library",
        authors = "author",
        series = "series",
        collections = "collection",
        ["smart-scopes"] = "smart-scope",
    }
    return map[section_name]
end

return Config
