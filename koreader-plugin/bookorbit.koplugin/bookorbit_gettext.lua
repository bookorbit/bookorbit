--[[
Translations for the plugin's own strings.

KOReader's gettext only loads KOReader's catalog, so a plugin string is
translated only when KOReader happens to ship the same text. This module is a
drop-in for require("gettext"): _() and _.ngettext() look the string up in
l10n/<lang>.po next to the plugin first, and everything else, including
pgettext and current_lang, is KOReader's gettext.

<lang> is KOReader's current_lang, which KOReader sets, without the encoding,
only when it has a catalog of its own for the language (es, pt_BR...), so a
catalog is named like KOReader's l10n folder. The plural form comes from
KOReader's getPlural for that same language.
]]

local base = require("gettext")

local ESCAPES = { n = "\n", t = "\t", r = "\r", ['"'] = '"', ["\\"] = "\\" }

local function unquote(text)
    return (text:gsub("\\(.)", function(char) return ESCAPES[char] or char end))
end

-- Reads a PO file into the layout of KOReader's GetText.translation:
-- [msgid] = msgstr, or [msgid] = { [0] = form, [1] = form } for a plural.
-- Fuzzy, untranslated and msgctxt entries are skipped.
local function parsePo(path)
    local file = io.open(path, "r")
    if not file then return nil end

    local catalog, entry, field = {}, {}, nil
    local function flush()
        local msgid = entry.msgid
        if msgid and msgid ~= "" and not entry.fuzzy and not entry.msgctxt then
            if entry.msgid_plural then
                local forms = {}
                for n = 0, 5 do
                    if entry[n] ~= "" then forms[n] = entry[n] end
                end
                catalog[msgid] = forms
            elseif entry.msgstr ~= "" then
                catalog[msgid] = entry.msgstr
            end
        end
        entry, field = {}, nil
    end

    for line in file:lines() do
        local keyword, index, text = line:match('^(msg[%a_]+)%[?(%d*)%]?%s+"(.*)"%s*$')
        local more = not keyword and field and line:match('^%s*"(.*)"%s*$')
        if keyword then
            field = tonumber(index) or keyword
            entry[field] = unquote(text)
        elseif more then
            entry[field] = entry[field] .. unquote(more)
        elseif line:match("^#,.*fuzzy") then
            entry.fuzzy = true
        elseif line:match("^%s*$") then
            flush()
        end
    end
    flush()
    file:close()
    return catalog
end

-- The specs replace gettext with a bare function, which has no current_lang.
local lang = type(base) == "table" and base.current_lang
local dir = debug.getinfo(1, "S").source:match("^@(.*)[/\\]") or "."
local catalog = type(lang) == "string" and parsePo(dir .. "/l10n/" .. lang .. ".po") or {}

local GetText = {}

function GetText.ngettext(msgid, msgid_plural, n)
    local forms = catalog[msgid]
    return type(forms) == "table" and forms[base.getPlural(n)] or base.ngettext(msgid, msgid_plural, n)
end

return setmetatable(GetText, {
    __call = function(_, msgid)
        local text = catalog[msgid]
        return type(text) == "string" and text or base(msgid)
    end,
    __index = base,
})
