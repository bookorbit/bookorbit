-- Plugin-local translations layered on top of KOReader's gettext catalog.
-- KOReader's singleton only knows about the core catalog, so standalone
-- plugin strings need a small catalog of their own.
local GetText = require("gettext")
local function coreIndex(key)
    if type(GetText) == "table" then return GetText[key] end
end

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
        require("logger").warn("BookOrbit: failed to load translation catalog", code)
        return nil
    end

    return try(lang) or try(lang:match("^(%a%a)")) or {}
end

local currentLang = coreIndex("current_lang")
local catalog = loadCatalog(currentLang)

local function getCatalog()
    local lang = coreIndex("current_lang")
    if lang ~= currentLang then
        currentLang = lang
        catalog = loadCatalog(lang)
    end
    return catalog
end

local BookOrbitGetText = setmetatable({}, {
    __call = function(_, msgid)
        local value = getCatalog()[msgid]
        if type(value) == "table" then value = value[0] end
        return value or GetText(msgid)
    end,
    __index = function(_, key)
        if key == "ngettext" then
            return function(msgid, msgid_plural, n)
                local value = getCatalog()[msgid]
                if type(value) == "table" then
                    local getPlural = coreIndex("getPlural")
                    local index = getPlural and getPlural(n) or (n == 1 and 0 or 1)
                    return value[index] or (index == 0 and msgid or msgid_plural)
                end
                local ngettext = coreIndex("ngettext")
                return ngettext and ngettext(msgid, msgid_plural, n)
                    or GetText(n == 1 and msgid or msgid_plural)
            end
        end
        return coreIndex(key)
    end,
})

return BookOrbitGetText
