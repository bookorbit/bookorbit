-- Proves the plugin's own catalog: a string in l10n/<lang>.po wins, anything
-- else falls through to KOReader's gettext, an untranslated or fuzzy entry is
-- left to KOReader, a msgctxt entry is found only through pgettext, a plural
-- takes the form l10n/languages.lua gives (KOReader's rule for an unlisted
-- language), pt_BR falls back to pt but Chinese never crosses scripts, and a
-- broken or oversized catalog leaves the plugin in English. Test catalogs live
-- in a temporary folder, never in the shipped l10n/. Then checks every
-- shipped catalog against its language's rule.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/helpers/?.lua;" .. package.path

local TempFilesystem = require("temp_filesystem")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %q, got %q", label, tostring(expected), tostring(actual)), 2)
    end
end

local RU = dofile("koreader-plugin/bookorbit.koplugin/l10n/languages.lua").ru
local function englishRule(n) return n ~= 1 and 1 or 0 end

-- KOReader's gettext, reduced to what the plugin touches.
local function fakeKoreader(lang, opts)
    opts = opts or {}
    local translations = { ["Cancel"] = "Cancelar (KOReader)" }
    return setmetatable({
        current_lang = lang,
        getPlural = opts.rule or englishRule,
        ngettext = opts.ngettext,
        pgettext = function(msgctxt, msgid) return msgctxt == "Menu" and msgid == "Open" and "Abrir (KOReader)" or msgid end,
    }, {
        __call = function(_, msgid) return translations[msgid] or msgid end,
    })
end

package.loaded["gettext"] = function(text) return text end
local GetText = require("bookorbit_gettext")
package.loaded["bookorbit_gettext"] = nil

local CATALOG = [[
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\n"
"Plural-Forms: nplurals=2; plural=n != 1;\n"

msgid "Sync now"
msgstr "Prueba uno"

msgid ""
"Two lines.\n"
"Second \"quoted\" line."
msgstr ""
"Dos lineas.\n"
"Segunda linea \"entre comillas\"."

msgid "%1 book"
msgid_plural "%1 books"
msgstr[0] "%1 prueba"
msgstr[1] "%1 pruebas"

msgid "Read"
msgstr "Leido prueba"

msgid "Not translated yet"
msgstr ""

#, fuzzy
msgid "Unsure"
msgstr "Dudoso"

#~ msgid "Old text"
#~ msgstr "Texto viejo"

msgctxt "Month"
msgid "May"
msgid_plural "Mays"
msgstr[0] "Mayo"
msgstr[1] "Mayos"
msgid "No blank line before"
msgstr "Sin linea en blanco"

msgctxt "Action"
msgid "Read"
msgstr "Leer prueba"]]

local THREE_FORMS = [[
msgid "%1 book"
msgid_plural "%1 books"
msgstr[0] "%1 one"
msgstr[1] "%1 few"
msgstr[2] "%1 many"
]]

local fs = TempFilesystem.new()
local dir = fs.path .. "/"
fs:makePath(dir .. "l10n")
local function catalog(name, body) fs:write(body, dir .. "l10n/" .. name .. ".po") end
local function load(lang, opts)
    opts = opts or {}
    return GetText.new({ dir = dir, core = opts.core or fakeKoreader(lang, opts), languages = opts.languages or {} })
end

local ok, failure = pcall(function()
    catalog("zz", CATALOG)
    catalog("zw", (CATALOG:gsub("\n", "\r\n")))
    catalog("zb", "\239\187\191" .. CATALOG)
    catalog("zr", THREE_FORMS)
    catalog("pt", 'msgid "Sync now"\nmsgstr "Sincronizar agora"\n')
    catalog("zh_CN", 'msgid "Sync now"\nmsgstr "Simplified"\n')
    catalog("zh", 'msgid "Sync now"\nmsgstr "Bare zh"\n')
    catalog("broken", 'msgid "Sync now"\nmsgstr "Unterminated\n\n\0\0')
    catalog("huge", 'msgid "Sync now"\nmsgstr "Too big"\n' .. string.rep("#", 2 * 1024 * 1024))

    local _ = load("zz")
    assertEqual(_("Sync now"), "Prueba uno", "plugin string")
    assertEqual(_("Two lines.\nSecond \"quoted\" line."), "Dos lineas.\nSegunda linea \"entre comillas\".", "multi-line string")
    assertEqual(_("Cancel"), "Cancelar (KOReader)", "KOReader fallback")
    assertEqual(_("Only in English"), "Only in English", "unknown string")
    assertEqual(_("Not translated yet"), "Not translated yet", "empty msgstr")
    assertEqual(_("Unsure"), "Unsure", "fuzzy entry")
    assertEqual(_("Old text"), "Old text", "obsolete entry")
    assertEqual(_(""), "", "the header is not a translation")
    assertEqual(_("No blank line before"), "Sin linea en blanco", "entry right after a plural, no blank line")
    assertEqual(_.npgettext("Month", "May", "Mays", 1), "Mayo", "context plural, one")
    assertEqual(_.npgettext("Month", "May", "Mays", 3), "Mayos", "context plural, other")
    assertEqual(_.ngettext("%1 book", "%1 books", 1), "%1 prueba", "singular")
    assertEqual(_.ngettext("%1 book", "%1 books", 5), "%1 pruebas", "plural")
    assertEqual(_.ngettext("1 stop", "%1 stops", 1), "1 stop", "unknown plural, singular")
    assertEqual(_.ngettext("1 stop", "%1 stops", 21), "%1 stops", "unknown plural follows the English rule")
    assertEqual(_("%1 book"), "%1 prueba", "plural entry looked up on its own")
    assertEqual(_.pgettext("Action", "Read"), "Leer prueba", "context entry, last in a file without a final newline")
    assertEqual(_("Read"), "Leido prueba", "bare entry next to a context entry")
    assertEqual(_.pgettext("Status", "Read"), "Read", "unknown context")
    assertEqual(_.pgettext("Menu", "Open"), "Abrir (KOReader)", "context fallback to KOReader")
    local info = _.info()
    assertEqual(info.catalog, "zz", "info: catalog")
    assertEqual(info.plural, "koreader", "info: unlisted language follows KOReader's rule")
    assertEqual(info.strings, 7, "info: translated entries, fuzzy and empty left out")

    _ = load("zw")
    assertEqual(_("Two lines.\nSecond \"quoted\" line."), "Dos lineas.\nSegunda linea \"entre comillas\".", "CRLF catalog")
    assertEqual(_.pgettext("Action", "Read"), "Leer prueba", "CRLF catalog, context entry")
    assertEqual(load("zb")("Sync now"), "Prueba uno", "catalog with a byte order mark")

    -- A missing plural goes to KOReader's ngettext when it has one.
    _ = load("zz", { ngettext = function(s, p, n) return "KOReader: " .. (n == 1 and s or p) end })
    assertEqual(_.ngettext("1 stop", "%1 stops", 2), "KOReader: %1 stops", "plural fallback to KOReader's ngettext")

    -- The form comes from l10n/languages.lua when the language is listed, even
    -- when KOReader's rule disagrees; from KOReader's rule otherwise.
    _ = load("zr", { rule = englishRule, languages = { zr = RU } })
    for n, expected in pairs({ [1] = "%1 one", [21] = "%1 one", [3] = "%1 few", [24] = "%1 few", [5] = "%1 many", [11] = "%1 many", [12] = "%1 many" }) do
        assertEqual(_.ngettext("%1 book", "%1 books", n), expected, "listed rule, n = " .. n)
    end
    assertEqual(_.info().plural, "plugin", "info: listed language uses the plugin's rule")
    assertEqual(_.ngettext("%1 book", "%1 books", 1.5), "%1 books", "a form the catalog lacks is left in English")
    assertEqual(_.ngettext("%1 book", "%1 books", nil), "%1 many", "a count that has not loaded reads as none")
    _ = load("zr", { rule = RU.plural })
    assertEqual(_.ngettext("%1 book", "%1 books", 21), "%1 one", "unlisted language, KOReader's rule")

    -- Language fallbacks.
    assertEqual(load("pt_BR")("Sync now"), "Sincronizar agora", "pt_BR falls back to pt")
    assertEqual(load("pt")("Sync now"), "Sincronizar agora", "pt")
    assertEqual(load("zh_CN")("Sync now"), "Simplified", "zh_CN exact")
    assertEqual(load("zh_TW")("Sync now"), "Sync now", "zh_TW never falls back to zh or zh_CN")
    assertEqual(load("en")("Sync now"), "Sync now", "English reads no catalog")
    assertEqual(load("C")("Sync now"), "Sync now", "C reads no catalog")
    assertEqual(load("de")("Sync now"), "Sync now", "language without a catalog")
    assertEqual(load("de").info().catalog, nil, "info: no catalog")

    -- A damaged or oversized catalog never breaks the plugin.
    assertEqual(load("broken")("Something"), "Something", "damaged catalog")
    assertEqual(load("huge")("Sync now"), "Sync now", "catalog over 2 MB is not loaded")

    -- The other specs replace gettext with a bare function, or with a table
    -- that has no pgettext, ngettext or current_lang.
    _ = GetText.new({ dir = dir, core = function(text) return text end })
    assertEqual(_("Sync now"), "Sync now", "function stub")
    assertEqual(_.pgettext("Action", "Read"), "Read", "function stub with a context")
    assertEqual(_.ngettext("%1 book", "%1 books", 1), "%1 book", "function stub, singular")
    assertEqual(_.ngettext("%1 book", "%1 books", 2), "%1 books", "function stub, plural")
    _ = GetText.new({ dir = dir, core = setmetatable({}, { __call = function(_, text) return text end }) })
    assertEqual(_.ngettext("%1 book", "%1 books", 2), "%1 books", "table stub")
    assertEqual(_.pgettext("Action", "Read"), "Read", "table stub without pgettext")

    -- The pseudo-translation for development ignores every catalog.
    _ = GetText.new({ dir = dir, lang = "es", pseudo = true, core = fakeKoreader("es") })
    assertEqual(_("Sync now"), "[\197\160\195\189\195\177\195\167 \195\177\195\179\197\181 ~~~]", "pseudo: accented, padded, bracketed")
    assertEqual(_.ngettext("1 book", "%1 books", 3), "[%1 \198\128\195\179\195\179\196\183\197\161 ~~]", "pseudo: plural keeps %1")
    assertEqual(_.ngettext("1 book", "%1 books", 1), "[1 \198\128\195\179\195\179\196\183 ~~]", "pseudo: singular")
    assertEqual(_.pgettext("Action", "Open"), "[\195\147\195\190\195\169\195\177 ~~]", "pseudo: context")
    assertEqual(_.npgettext("Unit", "%1 day", "%1 days", 2), "[%1 \195\176\195\161\195\189\197\161 ~~]", "pseudo: context plural")
    assertEqual(_("Cancel"):sub(1, 1), "[", "pseudo: KOReader's translation is not used")
    assertEqual(_(""), "", "pseudo: empty text stays empty")
    assertEqual(_.info().catalog, "pseudo", "info: pseudo")
end)
fs:cleanup()
if not ok then error(failure, 0) end

-- Every shipped catalog: its language is listed, its header matches, and every
-- form it translates comes back from the plugin with every %N of its source.
-- A form the rule also uses for counts other than 1 (form 0 serves 21 in
-- Russian) must keep the markers of the plural.
local Po = require("bookorbit_po")
local LANGUAGES = dofile("koreader-plugin/bookorbit.koplugin/l10n/languages.lua")

local function checkMarkers(lang, source, translated)
    for marker in source:gmatch("%%%d") do
        if not translated:find(marker, 1, true) then
            error(string.format("%s.po drops %s in %q", lang, marker, source), 0)
        end
    end
end

local shipped = 0
for lang, language in pairs(LANGUAGES) do
    local file = assert(io.open("koreader-plugin/bookorbit.koplugin/l10n/" .. lang .. ".po", "r"))
    local content = file:read("*a")
    file:close()
    local entries, header = Po.parse(content)
    assertEqual(Po.headerField(header, "Plural-Forms"), language.plural_forms, lang .. ".po Plural-Forms")
    local samples, general = {}, {}
    for _i, n in ipairs({ 1.5, 0, 1, 2, 3, 4, 5, 11, 12, 21, 22, 25, 100, 101, 111 }) do
        local form = language.plural(n)
        if samples[form] == nil then samples[form] = n end
        if n ~= 1 then general[form] = true end
    end
    for form = 0, language.forms - 1 do
        if samples[form] == nil then error(lang .. ": no sample count reaches form " .. form, 0) end
    end
    local _ = GetText.new({ lang = lang, core = function(text) return text end })
    assertEqual(_.info().catalog, lang, lang .. " loads its own catalog")
    assertEqual(_.info().plural, "plugin", lang .. " uses the plugin's rule")
    local checked, plurals = 0, 0
    for _i, entry in ipairs(entries) do
        if entry.fuzzy then
            -- left to KOReader, as the catalog test above proves
        elseif entry.msgid_plural then
            for form = 0, language.forms - 1 do
                if (entry[form] or "") == "" then
                    error(string.format("%s.po has no form %d for %q", lang, form, entry.msgid), 0)
                end
                local translated = entry.msgctxt and _.npgettext(entry.msgctxt, entry.msgid, entry.msgid_plural, samples[form])
                    or _.ngettext(entry.msgid, entry.msgid_plural, samples[form])
                assertEqual(translated, entry[form], lang .. ".po form " .. form .. " of " .. entry.msgid)
                checkMarkers(lang, general[form] and entry.msgid_plural or entry.msgid, translated)
                checked = checked + 1
            end
            plurals = plurals + 1
        elseif (entry.msgstr or "") ~= "" then
            local translated = entry.msgctxt and _.pgettext(entry.msgctxt, entry.msgid) or _(entry.msgid)
            assertEqual(translated, entry.msgstr, lang .. ".po lookup of " .. entry.msgid)
            checkMarkers(lang, entry.msgid, translated)
            checked = checked + 1
        end
    end
    if checked < 1000 or plurals == 0 then
        error(string.format("%s.po: only %d forms and %d plurals checked", lang, checked, plurals), 0)
    end
    shipped = shipped + 1
end
if shipped == 0 then error("no shipped catalog checked", 0) end

print("bookorbit_gettext_test: ok")
