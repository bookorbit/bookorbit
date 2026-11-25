-- Keeps the plugin translatable: every module translates through
-- bookorbit_gettext, counts use ngettext instead of an English-only "== 1"
-- test, _() only ever receives literal text (so the template extraction sees
-- it), and weekday and month names come from KOReader's translations or
-- bookorbit_dates rather than from os.date, which always answers in English.

local DIR = "koreader-plugin/bookorbit.koplugin"

local function luaFiles()
    local files = {}
    local pipe = assert(io.popen("find " .. DIR .. " -name '*.lua' -type f | sort"))
    for path in pipe:lines() do table.insert(files, path) end
    pipe:close()
    assert(#files > 50, "found only " .. #files .. " plugin files")
    return files
end

-- os.date names in English; these lines only turn them into keys of
-- KOReader's translation tables.
local OS_DATE_KEYS = {
    ['local short = os.date("%a", t)'] = true,
    ['local long = os.date("%B", t)'] = true,
    ['local short = os.date("%b", t)'] = true,
}

local problems = {}
local function problem(path, number, what, line)
    table.insert(problems, string.format("%s:%d: %s: %s", path, number, what, line:gsub("^%s+", "")))
end

for _i, path in ipairs(luaFiles()) do
    local name = path:match("[^/]+$")
    local number = 0
    for line in io.lines(path) do
        number = number + 1
        local code = line:gsub("%-%-.*$", "")
        if code:find('require%("gettext"%)') and name ~= "bookorbit_gettext.lua" then
            problem(path, number, 'translate with require("bookorbit_gettext")', line)
        end
        if code:find('_%(%s*"1 ') or code:find("==%s*1%s+and%s+T%(") or code:find("[%.:]plural%(") then
            problem(path, number, "count with _.ngettext, not an English-only singular", line)
        end
        if code:find("[^%w_%.]_%(%s*[^%s\"%[]") or code:find("^_%(%s*[^%s\"%[]") then
            problem(path, number, "_() takes literal text only", line)
        end
        local trimmed = code:gsub("^%s+", ""):gsub("%s+$", "")
        if code:find('os%.date%("[^"]*%%[aAbBp]') and not OS_DATE_KEYS[trimmed] then
            problem(path, number, "weekday and month names come from KOReader or bookorbit_dates", line)
        end
    end
end

if #problems > 0 then error("\n" .. table.concat(problems, "\n"), 0) end
print("bookorbit_l10n_guard_test: ok")
