-- Proves the plugin's own catalog: a string in l10n/<lang>.po wins, anything
-- else falls through to KOReader's gettext, an untranslated or fuzzy entry is
-- left to KOReader, and a msgctxt entry is found only through pgettext.

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
        pgettext = function(msgctxt, msgid) return msgctxt == "menu" and msgid == "Open" and "Abrir (KOReader)" or msgid end,
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

msgid "Read"
msgstr "Leido prueba"

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
    assertEqual(_("%1 book"), "%1 prueba", "plural entry looked up on its own")
    assertEqual(_.pgettext("verb", "Read"), "Leer prueba", "context entry")
    assertEqual(_("Read"), "Leido prueba", "bare entry next to a context entry")
    assertEqual(_.pgettext("noun", "Read"), "Read", "unknown context")
    assertEqual(_.pgettext("menu", "Open"), "Abrir (KOReader)", "context fallback to KOReader")
    assertEqual(_.current_lang, "zz", "KOReader field passthrough")

    _ = load("en_US")
    assertEqual(_("Sync now"), "Sync now", "language without a catalog")

    -- The existing specs replace gettext with a bare function.
    _ = load(nil)
    assertEqual(_("Sync now"), "Sync now", "function stub")
    assertEqual(_.pgettext("verb", "Read"), "Read", "function stub with a context")
end)
os.remove(path)
package.loaded["bookorbit_gettext"] = nil
if not ok then error(failure, 0) end

-- Reads every entry of a shipped catalog without the loader: continuation
-- lines, escaped quotes, msgctxt and the indexed forms of a plural.
local UNESCAPE = { n = "\n", t = "\t", ['"'] = '"', ["\\"] = "\\" }
local function readEntries(content)
    local entries, entry, field = {}, {}, nil
    local function flush()
        if entry.msgid and entry.msgid ~= "" then table.insert(entries, entry) end
        entry, field = {}, nil
    end
    for line in (content:gsub("\r", "") .. "\n"):gmatch("(.-)\n") do
        local keyword, index, text = line:match('^(msg[%a_]+)%[?(%d*)%]?%s+"(.*)"$')
        local more = not keyword and field and line:match('^"(.*)"$')
        if keyword then
            field = index ~= "" and tonumber(index) or keyword
            entry[field] = text:gsub("\\(.)", UNESCAPE)
        elseif more then
            entry[field] = entry[field] .. more:gsub("\\(.)", UNESCAPE)
        elseif line:match("^#,.*fuzzy") then
            entry.fuzzy = true
        elseif line == "" then
            flush()
        end
    end
    flush()
    return entries
end

local function checkMarkers(lang, source, translated)
    for marker in source:gmatch("%%%d") do
        if not translated:find(marker, 1, true) then
            error(string.format("%s.po drops %s in %q", lang, marker, source), 0)
        end
    end
end

-- Every form a shipped catalog translates must come back from the plugin and
-- keep every %N of its source.
local shipped = { "es" }
for _, lang in ipairs(shipped) do
    local file = assert(io.open("koreader-plugin/bookorbit.koplugin/l10n/" .. lang .. ".po", "r"))
    local content = file:read("*a")
    file:close()
    local _ = load(lang)
    local checked, plurals = 0, 0
    for _i, entry in ipairs(readEntries(content)) do
        if entry.fuzzy then
            -- left to KOReader, as the catalog test above proves
        elseif entry.msgid_plural then
            -- The fake KOReader picks form 0 for one and form 1 for any other count.
            for form, n in pairs({ [0] = 1, [1] = 5 }) do
                if (entry[form] or "") ~= "" then
                    local translated = _.ngettext(entry.msgid, entry.msgid_plural, n)
                    assertEqual(translated, entry[form], lang .. ".po form " .. form .. " of " .. entry.msgid)
                    checkMarkers(lang, form == 0 and entry.msgid or entry.msgid_plural, translated)
                    checked = checked + 1
                end
            end
            plurals = plurals + 1
        elseif entry.msgstr ~= "" then
            local translated = entry.msgctxt and _.pgettext(entry.msgctxt, entry.msgid) or _(entry.msgid)
            assertEqual(translated, entry.msgstr, lang .. ".po lookup of " .. entry.msgid)
            checkMarkers(lang, entry.msgid, translated)
            checked = checked + 1
        end
    end
    if checked < 1000 or plurals == 0 then
        error(string.format("%s.po: only %d forms and %d plurals checked", lang, checked, plurals), 0)
    end
end

print("bookorbit_gettext_test: ok")
