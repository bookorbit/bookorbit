--[[
Checks the plugin's translations. Run from anywhere with luajit:

    luajit koreader-plugin/l10n/check.lua

Fails when the template is out of date with the source, a catalog's language
is not in languages.lua or its header disagrees with it, a plural lacks a
form, a translation drops or invents a %1-style marker, or a translation adds
a link, a domain, an HTML tag or an em dash the English does not have. Prints
each language's coverage as a Markdown table; untranslated text is never an
error, because it stays English on the device.
]]

local here = (arg and arg[0] or ""):match("^(.*[/\\])") or "./"
local plugin = here .. "../bookorbit.koplugin/"
package.path = plugin .. "?.lua;" .. package.path

local Po = require("bookorbit_po")
local LANGUAGES = dofile(plugin .. "l10n/languages.lua")

local problems = {}
local function problem(fmt, ...)
    table.insert(problems, string.format(fmt, ...))
end

local function read(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local content = file:read("*a")
    file:close()
    return content
end

local function shell(text) return "'" .. text:gsub("'", "'\\''") .. "'" end

local function key(entry)
    return entry.msgctxt and entry.msgctxt .. "\4" .. entry.msgid or entry.msgid
end

local function label(entry)
    return (entry.msgctxt and "[" .. entry.msgctxt .. "] " or "") .. string.format("%q", entry.msgid)
end

-- The template, and whether it matches the source.
local pot_path = here .. "bookorbit.pot"
local pot = read(pot_path)
if not pot then
    problem("koreader-plugin/l10n/bookorbit.pot is missing: run pnpm koreader:l10n:extract")
    pot = ""
end
local fresh_path = os.tmpname()
local extracted = os.execute("bash " .. shell(here .. "extract.sh") .. " " .. shell(fresh_path) .. " >/dev/null")
if extracted ~= 0 and extracted ~= true then
    problem("could not extract the template (is GNU gettext installed?)")
else
    local function undated(text) return (text:gsub('"POT%-Creation%-Date: [^\n]*\n', "")) end
    if undated(read(fresh_path) or "") ~= undated(pot) then
        problem("koreader-plugin/l10n/bookorbit.pot is out of date: run pnpm koreader:l10n:extract and commit it")
    end
end
os.remove(fresh_path)

local template = {}
local template_count = 0
for _i, entry in ipairs((Po.parse(pot))) do
    template[key(entry)] = entry
    template_count = template_count + 1
end

-- Links, domains and tags in a text, each mapped to true.
local TLDS = { com = true, org = true, net = true, io = true, app = true, dev = true, me = true, info = true, co = true, ru = true, es = true, de = true, fr = true, link = true, ly = true, gg = true }
local function extras(text)
    local found = {}
    for link in text:gmatch("%a[%w+.-]*://[^%s\"')]*") do found[(link:gsub("[.,;:!?]+$", ""))] = true end
    for link in text:gmatch("www%.[^%s\"')]+") do found[(link:gsub("[.,;:!?]+$", ""))] = true end
    for name, tld in text:gmatch("([%w][%w-]*)%.(%a%a+)%f[^%w]") do
        if TLDS[tld:lower()] then found[name .. "." .. tld] = true end
    end
    for tag in text:gmatch("</?%a[^>]*>") do found[tag] = true end
    return found
end

local function markers(text)
    local found = {}
    for marker in text:gmatch("%%%d") do found[marker] = true end
    return found
end

local EM_DASH = "\226\128\148"

local function checkText(lang, entry, form, translated, source)
    local where = string.format("%s.po %s%s", lang, label(entry), form and " form " .. form or "")
    for marker in pairs(markers(source)) do
        if not translated:find(marker, 1, true) then problem("%s: drops %s", where, marker) end
    end
    local known = markers(entry.msgid .. " " .. (entry.msgid_plural or ""))
    for marker in pairs(markers(translated)) do
        if not known[marker] then problem("%s: adds %s, which the English does not have", where, marker) end
    end
    local english = entry.msgid .. " " .. (entry.msgid_plural or "")
    for extra in pairs(extras(translated)) do
        if not english:find(extra, 1, true) then problem("%s: adds %s, which the English does not have", where, extra) end
    end
    if translated:find(EM_DASH, 1, true) then problem("%s: uses an em dash; use a hyphen, colon or comma", where) end
end

local function catalogs()
    local list = {}
    local pipe = assert(io.popen("ls " .. shell(plugin .. "l10n") .. " 2>/dev/null"))
    for name in pipe:lines() do
        local lang = name:match("^(.+)%.po$")
        if lang then table.insert(list, lang) end
    end
    pipe:close()
    table.sort(list)
    return list
end

local rows = {}
for _i, lang in ipairs(catalogs()) do
    local language = LANGUAGES[lang]
    local content = read(plugin .. "l10n/" .. lang .. ".po")
    local ok, entries, header = pcall(Po.parse, content)
    if not language then
        problem("%s.po: add a %s row to bookorbit.koplugin/l10n/languages.lua (see the translator guide)", lang, lang)
    elseif not ok then
        problem("%s.po: cannot be read: %s", lang, tostring(entries))
    else
        if Po.headerField(header, "Plural-Forms") ~= language.plural_forms then
            problem("%s.po: Plural-Forms must be %q, as in languages.lua", lang, language.plural_forms)
        end
        local content_type = Po.headerField(header, "Content-Type") or ""
        if not content_type:lower():find("charset=utf%-8") then
            problem("%s.po: Content-Type must say charset=UTF-8", lang)
        end
        local declared = Po.headerField(header, "Language")
        if declared ~= lang then
            problem("%s.po: Language must be %s, the file's name", lang, lang)
        end

        -- Which forms the rule also uses for counts other than 1.
        local general = {}
        for _j, n in ipairs({ 0, 2, 3, 4, 5, 11, 12, 21, 22, 25, 100, 101, 111, 1.5 }) do
            general[language.plural(n)] = true
        end

        local translated, fuzzy, stale = 0, 0, 0
        for _j, entry in ipairs(entries) do
            local current = template[key(entry)]
            if entry.fuzzy then
                if current then fuzzy = fuzzy + 1 end
            elseif entry.msgid_plural then
                local filled = 0
                for form = 0, language.forms - 1 do
                    if (entry[form] or "") ~= "" then filled = filled + 1 end
                end
                if filled > 0 then
                    for form = 0, language.forms - 1 do
                        local text = entry[form] or ""
                        if text == "" then
                            problem("%s.po %s: form %d is empty; fill every form", lang, label(entry), form)
                        else
                            checkText(lang, entry, form, text, general[form] and entry.msgid_plural or entry.msgid)
                        end
                    end
                    if entry[language.forms] then
                        problem("%s.po %s: has more forms than %s uses (%d)", lang, label(entry), lang, language.forms)
                    end
                    if current then translated = translated + 1 else stale = stale + 1 end
                end
            elseif (entry.msgstr or "") ~= "" then
                checkText(lang, entry, nil, entry.msgstr, entry.msgid)
                if current then translated = translated + 1 else stale = stale + 1 end
            end
        end
        table.insert(rows, { lang = lang, translated = translated, fuzzy = fuzzy, stale = stale })
    end
end

print("| Language | Translated | Drafts (fuzzy) | Untranslated | Coverage | No longer used |")
print("| --- | ---: | ---: | ---: | ---: | ---: |")
for _i, row in ipairs(rows) do
    local untranslated = template_count - row.translated
    local coverage = template_count > 0 and math.floor(row.translated * 1000 / template_count) / 10 or 0
    print(string.format("| %s | %d | %d | %d | %.1f%% | %d |", row.lang, row.translated, row.fuzzy, untranslated, coverage, row.stale))
end
print(string.format("\n%d strings in the template.", template_count))

if #problems > 0 then
    io.stdout:flush()
    io.stderr:write("\n" .. #problems .. " translation problem(s):\n")
    for _i, text in ipairs(problems) do io.stderr:write("  " .. text .. "\n") end
    os.exit(1)
end
