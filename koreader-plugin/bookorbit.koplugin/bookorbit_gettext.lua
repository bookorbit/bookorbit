--[[
The plugin's gettext. KOReader's own reads only KOReader's catalog, so it
translates a plugin string only when KOReader ships the same text.

Use it like KOReader's:

    local _ = require("bookorbit_gettext")
    local T = require("ffi/util").template

    _("Sign in")
    _.pgettext("Book field", "Series")
    T(_.ngettext("1 book", "%1 books", n), n)

It reads l10n/<lang>.po next to this file once, when the plugin loads, after
KOReader has set its language. <lang> is KOReader's current_lang (es, ru,
pt_BR...): the names of KOReader's own catalogs. pt_BR falls back to pt.po
when there is no pt_BR.po; Chinese never falls back across scripts. A plural
takes the form l10n/languages.lua gives for the language, or KOReader's rule
for a language not listed there. Whatever the catalog lacks, fuzzy entries
included, goes to KOReader's gettext and then stays English. A language
change applies on the restart KOReader asks for.

For development, the setting bookorbit_pseudo_translation = true in
settings.reader.lua replaces every plugin string with a pseudo-translation:
accented, about a third longer and bracketed, with %1, %2... intact. Text
that still reads as plain English is not translatable, and a missing closing
bracket shows text that does not fit.
]]

local Po = require("bookorbit_po")

local MAX_BYTES = 2 * 1024 * 1024
local OWN_DIR = debug.getinfo(1, "S").source:match("^@(.*[/\\])") or ""

local GetText = {}

local function warn(...)
    local ok, logger = pcall(require, "logger")
    if ok and type(logger) == "table" and logger.warn then logger.warn("BookOrbit:", ...) end
end

-- The catalog names to try for KOReader's language, most specific first.
function GetText.candidates(lang)
    if type(lang) ~= "string" or lang == "" or lang == "C" or lang:match("^en") then return {} end
    local list = { lang }
    local base = lang:match("^(%a+)[_%-]")
    if base and base ~= "zh" then table.insert(list, base) end
    return list
end

local function readCatalog(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local size = file:seek("end")
    if size and size > MAX_BYTES then
        file:close()
        warn("translation catalog over 2 MB, not loaded:", path)
        return nil
    end
    file:seek("set", 0)
    local content = file:read("*a")
    file:close()
    return content
end

local PSEUDO = {}
for plain, accented in ("a\195\161b\198\128c\195\167d\195\176e\195\169f\198\146g\196\157h\196\165i\195\173j\196\181k\196\183l\196\186m\201\177n\195\177o\195\179p\195\190q\199\171r\197\149s\197\161t\197\163u\195\186v\225\185\189w\197\181x\225\186\139y\195\189z\197\190"
    .. "A\195\129B\198\129C\195\135D\195\144E\195\137F\198\145G\196\156H\196\164I\195\141J\196\180K\196\182L\196\185M\225\185\128N\195\145O\195\147P\195\158Q\199\170R\197\148S\197\160T\197\162U\195\154V\225\185\188W\197\180X\225\186\138Y\195\157Z\197\189")
    :gmatch("(%a)([\192-\255][\128-\191]+)") do
    PSEUDO[plain] = accented
end

-- English text as a pseudo-translation; %1, %2... and other % sequences stay.
function GetText.pseudo(text)
    if type(text) ~= "string" or text == "" then return text end
    local out, letters, i = {}, 0, 1
    while i <= #text do
        local c = text:sub(i, i)
        if c == "%" then
            table.insert(out, text:sub(i, i + 1))
            i = i + 2
        else
            if c:match("%a") then letters = letters + 1 end
            table.insert(out, PSEUDO[c] or c)
            i = i + 1
        end
    end
    return "[" .. table.concat(out) .. " " .. string.rep("~", math.max(1, math.ceil(letters * 0.35))) .. "]"
end

-- [msgid] = msgstr, or the whole entry for a plural, whose forms sit at [0],
-- [1]...; an entry with a msgctxt is keyed msgctxt .. "\4" .. msgid, as in a
-- .mo file.
local function index(entries)
    local catalog, count = {}, 0
    for _i, entry in ipairs(entries) do
        if not entry.fuzzy then
            local key = entry.msgctxt and entry.msgctxt .. "\4" .. entry.msgid or entry.msgid
            if entry.msgid_plural then
                if (entry[0] or "") ~= "" then
                    catalog[key] = entry
                    count = count + 1
                end
            elseif (entry.msgstr or "") ~= "" then
                catalog[key] = entry.msgstr
                count = count + 1
            end
        end
    end
    return catalog, count
end

-- opts: core (KOReader's gettext; the specs pass a bare function or a table
-- that lacks some fields), lang (defaults to core.current_lang), dir (the
-- folder holding l10n/, defaults to this file's), languages (defaults to
-- l10n/languages.lua), pseudo (true for the pseudo-translation).
function GetText.new(opts)
    opts = opts or {}
    local base = opts.core
    local core = type(base) == "table" and base or {}
    local dir = opts.dir or OWN_DIR
    local languages = opts.languages
    if languages == nil then
        local ok, loaded = pcall(dofile, dir .. "l10n/languages.lua")
        languages = ok and type(loaded) == "table" and loaded or {}
    end
    local lang = opts.lang or core.current_lang

    if opts.pseudo then
        local P = GetText.pseudo
        local function english(msgid, msgid_plural, n) return P((n or 0) == 1 and msgid or msgid_plural) end
        return setmetatable({
            ngettext = english,
            pgettext = function(_msgctxt, msgid) return P(msgid) end,
            npgettext = function(_msgctxt, msgid, msgid_plural, n) return english(msgid, msgid_plural, n) end,
            info = function() return { language = lang, catalog = "pseudo", strings = 0, plural = "plugin" } end,
            new = GetText.new,
            candidates = GetText.candidates,
        }, {
            __call = function(_self, msgid) return P(msgid) end,
        })
    end

    local catalog, loaded = {}, { language = lang, strings = 0 }
    for _i, code in ipairs(GetText.candidates(lang)) do
        local content = readCatalog(dir .. "l10n/" .. code .. ".po")
        if content then
            local ok, entries = pcall(Po.parse, content)
            if ok then
                catalog, loaded.strings = index(entries)
                loaded.catalog = code
                break
            end
            warn("translation catalog unreadable, not loaded:", code, entries)
        end
    end

    local own = loaded.catalog and languages[loaded.catalog]
    local rule = own and own.plural or core.getPlural
    loaded.plural = own and "plugin" or "koreader"

    local function form(n)
        if rule then
            local ok, i = pcall(rule, n)
            if ok and type(i) == "number" then return i end
        end
        return n == 1 and 0 or 1
    end

    local function find(key, n)
        local text = catalog[key]
        if type(text) == "table" then text = text[n and form(n) or 0] end
        if text ~= nil and text ~= "" then return text end
    end

    local function untranslated(msgid)
        if base then return base(msgid) end
        return msgid
    end

    return setmetatable({
        -- A count that has not loaded yet reads as none.
        ngettext = function(msgid, msgid_plural, n)
            n = n or 0
            return find(msgid, n)
                or core.ngettext and core.ngettext(msgid, msgid_plural, n)
                or untranslated(n == 1 and msgid or msgid_plural)
        end,
        pgettext = function(msgctxt, msgid)
            return find(msgctxt .. "\4" .. msgid)
                or core.pgettext and core.pgettext(msgctxt, msgid)
                or msgid
        end,
        npgettext = function(msgctxt, msgid, msgid_plural, n)
            n = n or 0
            return find(msgctxt .. "\4" .. msgid, n)
                or core.npgettext and core.npgettext(msgctxt, msgid, msgid_plural, n)
                or (n == 1 and msgid or msgid_plural)
        end,
        -- What loaded, for Technical details: language (KOReader's), catalog
        -- (the file used, or nil), strings (translated entries) and plural
        -- ("plugin" or "koreader": whose rule picks the forms).
        info = function()
            return { language = loaded.language, catalog = loaded.catalog, strings = loaded.strings, plural = loaded.plural }
        end,
        new = GetText.new,
        candidates = GetText.candidates,
    }, {
        __call = function(_self, msgid) return find(msgid) or untranslated(msgid) end,
    })
end

local function pseudoSetting()
    local settings = rawget(_G, "G_reader_settings")
    if type(settings) ~= "table" then return false end
    local ok, on = pcall(settings.isTrue, settings, "bookorbit_pseudo_translation")
    return ok and on == true
end

return GetText.new({ core = require("gettext"), pseudo = pseudoSetting() })
