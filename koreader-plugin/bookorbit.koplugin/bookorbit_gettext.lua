--[[
The plugin's gettext. KOReader's own reads only KOReader's catalog, so it
translates a plugin string only when KOReader ships the same text.

Use it like KOReader's:

    local _ = require("bookorbit_gettext")
    local T = require("ffi/util").template

    _("Sign in")
    _.pgettext("Book field", "Series")
    T(_.ngettext("1 book", "%1 books", n), n)

Each lookup reads l10n/<lang>.po next to this file, where <lang> is KOReader's
current_lang (es, ru, pt_BR...: the names of KOReader's own catalogs), and a
plural takes the form KOReader's rule for that language picks. Whatever the
catalog lacks, fuzzy entries included, is answered by KOReader's gettext.

The catalog is read when the plugin loads, after KOReader has set its
language. A language change takes effect on the restart KOReader asks for.
]]

local base = require("gettext")
-- The specs stand in for KOReader's gettext with a bare function, or with a
-- table that lacks some of its fields.
local core = type(base) == "table" and base or {}

-- [msgid] = msgstr, or the whole entry for a plural, whose forms sit at [0],
-- [1]...; an entry with a msgctxt is keyed msgctxt .. "\4" .. msgid, as in a
-- .mo file.
local catalog = {}
local file = core.current_lang and io.open((debug.getinfo(1, "S").source:match("^@(.*[/\\])") or "")
    .. "l10n/" .. core.current_lang .. ".po")
if file then
    local ESCAPES = { n = "\n", t = "\t", r = "\r", ['"'] = '"', ["\\"] = "\\" }
    local entry, field = {}
    -- A blank line closes an entry; the two appended close the last one.
    for line in (file:read("*a") .. "\n\n"):gmatch("(.-)\r?\n") do
        local keyword, index, text = line:match('^(msg[%a_]+)%[?(%d*)%]?%s+"(.*)"%s*$')
        if keyword then
            field = tonumber(index) or keyword
            entry[field] = ""
        else
            text = field and line:match('^%s*"(.*)"%s*$')
        end
        if text then
            entry[field] = entry[field] .. text:gsub("\\(.)", ESCAPES)
        elseif line:find("^#,.*fuzzy") then
            entry.fuzzy = true
        elseif not line:find("%S") then
            if (entry.msgid or "") ~= "" and not entry.fuzzy then
                catalog[entry.msgctxt and entry.msgctxt .. "\4" .. entry.msgid or entry.msgid] = entry.msgid_plural and entry or entry.msgstr
            end
            entry, field = {}, nil
        end
    end
    file:close()
end

-- n picks the form of a plural entry; without it, the first form, as
-- KOReader's _() gives.
local function find(key, n)
    local text = catalog[key]
    if type(text) == "table" then text = text[n and core.getPlural(n) or 0] end
    if text ~= "" then return text end
end

return setmetatable({
    -- A count that has not loaded yet reads as none, and the English text
    -- left untranslated follows the English rule.
    ngettext = function(msgid, msgid_plural, n)
        return find(msgid, n or 0) or base(n == 1 and msgid or msgid_plural)
    end,
    pgettext = function(msgctxt, msgid)
        return find(msgctxt .. "\4" .. msgid) or core.pgettext and core.pgettext(msgctxt, msgid) or msgid
    end,
}, {
    __call = function(_, msgid) return find(msgid) or base(msgid) end,
})
