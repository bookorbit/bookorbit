-- Plugin-local translations layered on top of KOReader's gettext catalog.
-- KOReader's singleton only knows about the core catalog, so standalone
-- plugin strings need a small catalog of their own.
local GetText = require("gettext")
local logger = require("logger")

local function pluginDir()
    local source = debug.getinfo(1, "S").source
    return source:match("^@(.*)[/\\\\][^/\\\\]+$")
end

local function loadCatalog(lang)
    if not lang or lang == "" or lang == "C" or lang:match("^en") then return {} end
    local dir = pluginDir()
    if not dir then return {} end

    local function try(code)
        local chunk = loadfile(dir .. "/l10n/" .. code .. ".lua")
        if not chunk then return nil end
        local ok, catalog = pcall(chunk)
        if ok and type(catalog) == "table" then return catalog end
        logger.warn("BookOrbit: failed to load translation catalog", code)
        return nil
    end

    return try(lang) or try(lang:match("^(%a%a)")) or {}
end

local catalog = loadCatalog(GetText.current_lang)

local BookOrbitGetText = setmetatable({}, {
    __call = function(_, msgid)
        return catalog[msgid] or GetText(msgid)
    end,
    __index = function(_, key)
        if key == "ngettext" then
            return function(msgid, msgid_plural, n)
                local value = catalog[msgid]
                if type(value) == "table" then
                    local index = GetText.getPlural(n)
                    return value[index] or value[1] or msgid_plural
                end
                return GetText.ngettext(msgid, msgid_plural, n)
            end
        end
        return GetText[key]
    end,
})

return BookOrbitGetText
