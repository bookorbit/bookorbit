-- Proves the plugin's own catalog: a string in l10n/<lang>.po wins, anything
-- else falls through to KOReader's gettext, and an untranslated, fuzzy or
-- msgctxt entry is left to KOReader.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %q, got %q", label, tostring(expected), tostring(actual)), 2)
    end
end

-- KOReader's gettext, reduced to what the plugin touches.
local function fakeKoreader(lang)
    local translations = { ["Cancel"] = "Cancelar (KOReader)" }
    return setmetatable({
        current_lang = lang,
        getPlural = function(n) return n == 1 and 0 or 1 end,
        ngettext = function(one, many, n) return n == 1 and one or many end,
        pgettext = function(_, msgid) return msgid end,
    }, {
        __call = function(_, msgid) return translations[msgid] or msgid end,
    })
end

local function load(lang)
    package.loaded["bookorbit_gettext"] = nil
    package.loaded["gettext"] = lang and fakeKoreader(lang) or function(text) return text end
    return require("bookorbit_gettext")
end

local function writeCatalog(name, body)
    local path = "koreader-plugin/bookorbit.koplugin/l10n/" .. name .. ".po"
    local file = assert(io.open(path, "w"))
    file:write(body)
    file:close()
    return path
end

local CATALOG = [[
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\n"

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

msgctxt "verb"
msgid "Read"
msgstr "Leer prueba"

msgid "Not translated yet"
msgstr ""

#, fuzzy
msgid "Unsure"
msgstr "Dudoso"
]]

-- "zz" is not a language the plugin ships, so the test never touches a real catalog.
local path = writeCatalog("zz", CATALOG)
local ok, failure = pcall(function()
    local _ = load("zz")
    assertEqual(_("Sync now"), "Prueba uno", "plugin string")
    assertEqual(_("Two lines.\nSecond \"quoted\" line."), "Dos lineas.\nSegunda linea \"entre comillas\".", "multi-line string")
    assertEqual(_("Cancel"), "Cancelar (KOReader)", "KOReader fallback")
    assertEqual(_("Only in English"), "Only in English", "unknown string")
    assertEqual(_("Not translated yet"), "Not translated yet", "empty msgstr")
    assertEqual(_("Unsure"), "Unsure", "fuzzy entry")
    assertEqual(_.ngettext("%1 book", "%1 books", 1), "%1 prueba", "singular")
    assertEqual(_.ngettext("%1 book", "%1 books", 5), "%1 pruebas", "plural")
    assertEqual(_.ngettext("%1 stop", "%1 stops", 5), "%1 stops", "unknown plural")
    assertEqual(_.pgettext("verb", "Read"), "Read", "context goes to KOReader")
    assertEqual(_("Read"), "Read", "context entry not filed under its bare msgid")
    assertEqual(_.current_lang, "zz", "KOReader field passthrough")

    _ = load("en_US")
    assertEqual(_("Sync now"), "Sync now", "language without a catalog")

    -- The existing specs replace gettext with a bare function.
    _ = load(nil)
    assertEqual(_("Sync now"), "Sync now", "function stub")
end)
os.remove(path)
package.loaded["bookorbit_gettext"] = nil
if not ok then error(failure, 0) end

-- The catalogs the plugin ships must parse and must keep every %N of the source.
local shipped = { "es" }
for _, lang in ipairs(shipped) do
    local file = assert(io.open("koreader-plugin/bookorbit.koplugin/l10n/" .. lang .. ".po", "r"))
    local content = file:read("*a")
    file:close()
    local _ = load(lang)
    local checked = 0
    for msgid in content:gmatch('\nmsgid "([^"\n]+)"\nmsgstr "[^"\n]+"') do
        local source = msgid:gsub('\\"', '"'):gsub("\\n", "\n")
        local translated = _(source)
        for marker in source:gmatch("%%%d") do
            if not translated:find(marker, 1, true) then
                error(string.format("%s.po drops %s in %q", lang, marker, source), 0)
            end
        end
        checked = checked + 1
    end
    if checked < 500 then error(lang .. ".po: only " .. checked .. " entries checked", 0) end
end

print("bookorbit_gettext_test: ok")
