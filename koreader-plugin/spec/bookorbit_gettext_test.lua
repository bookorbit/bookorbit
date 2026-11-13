-- Proves the plugin's own catalog: a string in l10n/<lang>.po wins, anything
-- else falls through to KOReader's gettext, an untranslated or fuzzy entry is
-- left to KOReader, a msgctxt entry is found only through pgettext, and a
-- plural takes the form KOReader's rule picks. Then checks every shipped
-- catalog against its language's rule.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %q, got %q", label, tostring(expected), tostring(actual)), 2)
    end
end

-- The Plural-Forms of KOReader's own catalog for each shipped language
-- (koreader-translations/<lang>/koreader.po) and its rule in Lua. The plugin
-- picks the form with KOReader's rule, so its catalog declares the same
-- header. samples holds a count for each form.
local PLURALS = {
    es = {
        header = "nplurals=2; plural=n != 1;",
        rule = function(n) return n ~= 1 and 1 or 0 end,
        samples = { [0] = 1, [1] = 5 },
    },
    ru = {
        header = "nplurals=4; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : n%10==0 || (n%10>=5 && n%10<=9) || (n%100>=11 && n%100<=14)? 2 : 3);",
        rule = function(n)
            if n % 10 == 1 and n % 100 ~= 11 then return 0 end
            if n % 10 >= 2 and n % 10 <= 4 and (n % 100 < 12 or n % 100 > 14) then return 1 end
            if n % 10 == 0 or (n % 10 >= 5 and n % 10 <= 9) or (n % 100 >= 11 and n % 100 <= 14) then return 2 end
            return 3
        end,
        samples = { [0] = 21, [1] = 3, [2] = 11, [3] = 1.5 },
    },
}

-- KOReader's gettext, reduced to what the plugin touches.
local function fakeKoreader(lang, rule)
    local translations = { ["Cancel"] = "Cancelar (KOReader)" }
    return setmetatable({
        current_lang = lang,
        getPlural = rule or (PLURALS[lang] or PLURALS.es).rule,
        pgettext = function(msgctxt, msgid) return msgctxt == "Menu" and msgid == "Open" and "Abrir (KOReader)" or msgid end,
    }, {
        __call = function(_, msgid) return translations[msgid] or msgid end,
    })
end

local function load(lang, stub)
    package.loaded["bookorbit_gettext"] = nil
    package.loaded["gettext"] = stub or (lang and fakeKoreader(lang)) or function(text) return text end
    return require("bookorbit_gettext")
end

local function writeCatalog(name, body)
    local path = "koreader-plugin/bookorbit.koplugin/l10n/" .. name .. ".po"
    local file = assert(io.open(path, "wb"))
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

msgid "Not translated yet"
msgstr ""

#, fuzzy
msgid "Unsure"
msgstr "Dudoso"

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

-- "zz", "zw" and "zr" are not languages the plugin ships, so the test never
-- touches a real catalog.
local paths = { writeCatalog("zz", CATALOG), writeCatalog("zw", (CATALOG:gsub("\n", "\r\n"))), writeCatalog("zr", THREE_FORMS) }
local ok, failure = pcall(function()
    local _ = load("zz")
    assertEqual(_("Sync now"), "Prueba uno", "plugin string")
    assertEqual(_("Two lines.\nSecond \"quoted\" line."), "Dos lineas.\nSegunda linea \"entre comillas\".", "multi-line string")
    assertEqual(_("Cancel"), "Cancelar (KOReader)", "KOReader fallback")
    assertEqual(_("Only in English"), "Only in English", "unknown string")
    assertEqual(_("Not translated yet"), "Not translated yet", "empty msgstr")
    assertEqual(_("Unsure"), "Unsure", "fuzzy entry")
    assertEqual(_(""), "", "the header is not a translation")
    assertEqual(_.ngettext("%1 book", "%1 books", 1), "%1 prueba", "singular")
    assertEqual(_.ngettext("%1 book", "%1 books", 5), "%1 pruebas", "plural")
    assertEqual(_.ngettext("1 stop", "%1 stops", 1), "1 stop", "unknown plural, singular")
    assertEqual(_.ngettext("1 stop", "%1 stops", 21), "%1 stops", "unknown plural follows the English rule")
    assertEqual(_("%1 book"), "%1 prueba", "plural entry looked up on its own")
    assertEqual(_.pgettext("Action", "Read"), "Leer prueba", "context entry, last in a file without a final newline")
    assertEqual(_("Read"), "Leido prueba", "bare entry next to a context entry")
    assertEqual(_.pgettext("Status", "Read"), "Read", "unknown context")
    assertEqual(_.pgettext("Menu", "Open"), "Abrir (KOReader)", "context fallback to KOReader")

    _ = load("zw")
    assertEqual(_("Two lines.\nSecond \"quoted\" line."), "Dos lineas.\nSegunda linea \"entre comillas\".", "CRLF catalog")
    assertEqual(_.pgettext("Action", "Read"), "Leer prueba", "CRLF catalog, context entry")

    _ = load("C")
    assertEqual(_("Sync now"), "Sync now", "language without a catalog")

    -- The form is the one KOReader's rule for the language picks.
    _ = load(nil, fakeKoreader("zr", PLURALS.ru.rule))
    for n, expected in pairs({ [1] = "%1 one", [21] = "%1 one", [3] = "%1 few", [24] = "%1 few", [5] = "%1 many", [11] = "%1 many", [12] = "%1 many" }) do
        assertEqual(_.ngettext("%1 book", "%1 books", n), expected, "three forms, n = " .. n)
    end
    assertEqual(_.ngettext("%1 book", "%1 books", 1.5), "%1 books", "a form the catalog lacks is left in English")
    assertEqual(_.ngettext("%1 book", "%1 books", nil), "%1 many", "a count that has not loaded reads as none")

    -- The other specs replace gettext with a bare function, or with a table
    -- that has no pgettext or current_lang.
    _ = load(nil)
    assertEqual(_("Sync now"), "Sync now", "function stub")
    assertEqual(_.pgettext("Action", "Read"), "Read", "function stub with a context")
    assertEqual(_.ngettext("%1 book", "%1 books", 1), "%1 book", "function stub, singular")
    assertEqual(_.ngettext("%1 book", "%1 books", 2), "%1 books", "function stub, plural")
    _ = load(nil, setmetatable({}, { __call = function(_, text) return text end }))
    assertEqual(_.ngettext("%1 book", "%1 books", 2), "%1 books", "table stub")
    assertEqual(_.pgettext("Action", "Read"), "Read", "table stub without pgettext")
end)
for _, path in ipairs(paths) do os.remove(path) end
package.loaded["bookorbit_gettext"] = nil
if not ok then error(failure, 0) end

-- Reads every entry of a shipped catalog without the loader: continuation
-- lines, escaped quotes, msgctxt and the indexed forms of a plural.
local UNESCAPE = { n = "\n", t = "\t", r = "\r", ['"'] = '"', ["\\"] = "\\" }
local function readEntries(content)
    local entries, entry, field, header = {}, {}, nil, nil
    local function flush()
        if entry.msgid and entry.msgid ~= "" then table.insert(entries, entry)
        elseif entry.msgid == "" then header = entry.msgstr end
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
    return entries, header or ""
end

local function checkMarkers(lang, source, translated)
    for marker in source:gmatch("%%%d") do
        if not translated:find(marker, 1, true) then
            error(string.format("%s.po drops %s in %q", lang, marker, source), 0)
        end
    end
end

-- Every form a shipped catalog translates must come back from the plugin and
-- keep every %N of its source. A form the rule also uses for counts other
-- than 1 (form 0 serves 21 in Russian) must keep the markers of the plural.
for lang, plural in pairs(PLURALS) do
    local file = assert(io.open("koreader-plugin/bookorbit.koplugin/l10n/" .. lang .. ".po", "r"))
    local content = file:read("*a")
    file:close()
    local entries, header = readEntries(content)
    assertEqual(header:match("Plural%-Forms: ([^\n]*)"), plural.header, lang .. ".po Plural-Forms")
    local general = { [plural.rule(1.5)] = true }
    for n = 0, 200 do
        if n ~= 1 then general[plural.rule(n)] = true end
    end
    local _ = load(lang)
    local checked, plurals = 0, 0
    for _i, entry in ipairs(entries) do
        if entry.fuzzy then
            -- left to KOReader, as the catalog test above proves
        elseif entry.msgid_plural then
            for form, n in pairs(plural.samples) do
                if (entry[form] or "") == "" then
                    error(string.format("%s.po has no form %d for %q", lang, form, entry.msgid), 0)
                end
                local translated = _.ngettext(entry.msgid, entry.msgid_plural, n)
                assertEqual(translated, entry[form], lang .. ".po form " .. form .. " of " .. entry.msgid)
                checkMarkers(lang, general[form] and entry.msgid_plural or entry.msgid, translated)
                checked = checked + 1
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
