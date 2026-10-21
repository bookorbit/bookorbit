-- Proves the numbers and choices behind the decor widgets: the moon's phase
-- on known dates, the glyph of the day, chapter stops and the minutes to
-- each, months of reading, the badge summary and its time to go, and the
-- daily rotation through never-opened books.

package.loaded["gettext"] = setmetatable({
    ngettext = function(one, many, n) return n == 1 and one or many end,
}, { __call = function(_, text) return text end })
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}
package.loaded["util"] = { fixUtf8 = function(value) return value end }
package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["datetime"] = {
    shortDayOfWeekToLongTranslation = {},
    shortDayOfWeekTranslation = {},
    longMonthTranslation = {},
    shortMonthTranslation = {},
    secondsToHour = function() return "12:00" end,
    stringISO8601ToSeconds = function(iso)
        local y, m, d, hh, mm, ss = iso:match("^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
        if not y then return nil end
        return os.time({ year = tonumber(y), month = tonumber(m), day = tonumber(d), hour = tonumber(hh), min = tonumber(mm), sec = tonumber(ss) })
    end,
}
package.loaded["device"] = { hasFrontlight = function() return false end }
package.loaded["ui/network/manager"] = { isConnected = function() return true end }
package.loaded["bookorbit_stats_reader"] = {}
package.loaded["lua-ljsqlite3/init"] = false
package.loaded["datastorage"] = { getSettingsDir = function() return "/nonexistent" end, getDataDir = function() return "/nonexistent" end }

-- Files on the "device": modification times, and which have been opened.
local files = {}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(path, what)
        local f = files[path]
        if not f then return nil end
        if what == "modification" then return f.at end
        if what == "size" then return f.size end
        return "file"
    end,
}
local history = {}
package.loaded["readhistory"] = { hist = history }
package.loaded["docsettings"] = {
    hasSidecarFile = function(_, path) return files[path] and files[path].sidecar == true end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BoardData = require("bookorbit_board_data")
local ChapterMap = require("bookorbit_chapter_map")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local DAY = 86400

-- ------------------------------------------------------------------ moon
-- Known moons: 2026-10-10 was new, 2026-10-26 full, 2026-10-18 first quarter.
local moon = BoardData.moon(os.time({ year = 2026, month = 10, day = 11, hour = 0 }))
assertEqual(moon.phase, "new", "the night of 10 October 2026 is a new moon")
assertEqual(moon.lit < 0.01, true, "a new moon is dark")
assertEqual(moon.next:match("^Full moon") ~= nil, true, "a new moon looks ahead to the full moon")
moon = BoardData.moon(os.time({ year = 2026, month = 10, day = 26, hour = 12 }))
assertEqual(moon.phase, "full", "26 October 2026 is a full moon")
assertEqual(moon.lit > 0.98, true, "a full moon is lit")
assertEqual(moon.next:match("^New moon") ~= nil, true, "a full moon looks ahead to the new moon")
moon = BoardData.moon(os.time({ year = 2026, month = 10, day = 18, hour = 12 }))
assertEqual(moon.phase, "first_quarter", "18 October 2026 is the first quarter")
assertEqual(math.abs(moon.lit - 0.5) < 0.12, true, "a quarter moon is half lit")
moon = BoardData.moon(os.time({ year = 2026, month = 10, day = 14, hour = 12 }))
assertEqual(moon.phase, "waxing_crescent", "four days on is a waxing crescent")

-- ----------------------------------------------------------------- glyph
local monday = os.time({ year = 2026, month = 10, day = 12, hour = 9 })
local a = BoardData.glyphOfTheDay(monday)
local b = BoardData.glyphOfTheDay(monday + DAY)
assertEqual(a ~= b, true, "the glyph changes from one day to the next")
assertEqual(BoardData.glyphOfTheDay(monday + 3600), a, "and holds through the day")
assertEqual(BoardData.glyphOfTheDay(monday + #BoardData.GLYPHS * DAY), a, "the list comes round again")
local missing = a.font
local skipped = BoardData.glyphOfTheDay(monday, function(font) return font ~= missing end)
assertEqual(skipped.font ~= missing, true, "a glyph whose font is not on the device is passed over")
assertEqual(BoardData.glyphOfTheDay(monday, function() return false end), nil, "no fonts, no glyph")

-- -------------------------------------------------------------- chapters
-- A book in parts: depth 1 has three parts, depth 2 the chapters. Front
-- matter under 1% of the book folds away; the last entry always stays.
local map = {
    pages = 400,
    entries = {
        { t = "Title Page", p = 1, d = 1 },
        { t = "Copyright", p = 2, d = 1 },
        { t = "Part One", p = 3, d = 1 },
        { t = "Chapter 1", p = 3, d = 2 },
        { t = "Chapter 2", p = 60, d = 2 },
        { t = "Chapter 3", p = 120, d = 2 },
        { t = "Part Two", p = 180, d = 1 },
        { t = "Chapter 4", p = 180, d = 2 },
        { t = "Chapter 5", p = 250, d = 2 },
        { t = "Chapter 6", p = 320, d = 2 },
        { t = "Notes", p = 398, d = 1 },
    },
}
local stops = ChapterMap.stations(map)
local titles = {}
for i, s in ipairs(stops) do titles[i] = s.title end
assertEqual(table.concat(titles, ","), "Chapter 1,Chapter 2,Chapter 3,Chapter 4,Chapter 5,Chapter 6,Notes",
    "chapters, not parts, with the front matter folded away and the end kept")
-- A flat contents with enough entries uses them as they are.
local flat = { pages = 100, entries = {} }
for i = 1, 8 do table.insert(flat.entries, { t = "Ch " .. i, p = (i - 1) * 12 + 1, d = 1 }) end
assertEqual(#ChapterMap.stations(flat), 8, "a flat contents keeps every chapter")
assertEqual(ChapterMap.stations({ pages = 10, entries = { { t = "Only", p = 1, d = 1 } } }), nil, "one entry is no line")

-- The minutes to each stop come from the forecast's pace.
local saved_load = ChapterMap.load
ChapterMap.load = function() return map end
local book = { id = 9, progressPercentage = 20, minutes_left = 400 }
local line = BoardData.chapterLine(book, "abc")
ChapterMap.load = saved_load
assertEqual(line.stops[line.cur].title, "Chapter 2", "20% in is inside Chapter 2")
assertEqual(line.stops[line.next].title, "Chapter 3", "the next stop is Chapter 3")
-- Chapter 3 starts at (120 - 1) / 400 = 29.75%; 400 min over 80% is 5 a percent.
assertEqual(line.minutes(line.next), 49, "minutes to the next stop at this reader's pace")
assertEqual(BoardData.chapterLine({ id = 9, progressPercentage = 20 }, nil), nil, "no file on the device, no chapter line")

-- ---------------------------------------------------------------- months
local now = os.time({ year = 2026, month = 10, day = 14, hour = 15 })
local start = os.time({ year = 2025, month = 10, day = 19, hour = 12 })
local heat = {}
for i = 1, BoardData.HEATMAP_DAYS do heat[i] = 0 end
-- 30 minutes on 1 January 2026 and 20 on 2 October 2026.
heat[math.floor((os.time({ year = 2026, month = 1, day = 1, hour = 12 }) - start) / DAY + 0.5) + 1] = 30
heat[math.floor((os.time({ year = 2026, month = 10, day = 2, hour = 12 }) - start) / DAY + 0.5) + 1] = 20
local months = BoardData.monthTotals(heat, start, now)
assertEqual(#months, 12, "twelve months")
assertEqual(months[1].month .. "/" .. months[1].year, "11/2025", "starting eleven months back")
assertEqual(months[12].month .. "/" .. months[12].year, "10/2026", "ending with this month")
assertEqual(months[3].min, 30, "January's reading lands in January")
assertEqual(months[12].min, 20, "this month's reading lands in this month")

-- ---------------------------------------------------------------- badges
assertEqual(BoardData.badges({}, now).missing, true, "an older server sends no badges")
assertEqual(BoardData.badges({ achievements = function() end }, now).off, true, "null means achievements are off")
local summary = BoardData.badges({
    achievements = {
        earned = 61, total = 87,
        next = { key = "hours_read_3", groupKey = "hours_read", name = "Chronicle Veteran", description = "Read for 500 hours",
            rarity = "epic", iconName = "clock", threshold = 500, currentProgress = 472 },
        latest = { key = "library_builder_3", name = "Stack Sovereign", description = "Have 1,000 books", rarity = "epic",
            iconName = "library", awardedAt = os.date("!%Y-%m-%dT%H:%M:%SZ", now - 3600) },
    },
}, now, { minutes_per_day = 69 })
assertEqual(summary.next.name, "Chronicle Veteran", "the next badge")
-- 28 hours at 69 minutes a day is 24 days.
assertEqual(summary.next.eta, "About 3 weeks to go", "time to go at this reader's pace")
assertEqual(summary.fresh, true, "a badge earned in the last day is fresh")
assertEqual(summary.latest.when, "Earned today", "and was earned today")
assertEqual(BoardData.etaLabel(1), "About a day to go", "a day")
assertEqual(BoardData.etaLabel(5), "About 5 days to go", "days")
assertEqual(BoardData.etaLabel(90), "About 3 months to go", "months")
assertEqual(BoardData.etaLabel(2000), nil, "too far off to say")

-- --------------------------------------------------------- gathering dust
-- Four books on the device: one opened (in history), one with a sidecar,
-- two never opened, the older first.
files["/b/old.epub"] = { at = now - 200 * DAY, size = 3 * 1024 * 1024 }
files["/b/new.epub"] = { at = now - 20 * DAY, size = 1024 * 1024 }
files["/b/read.epub"] = { at = now - 300 * DAY, size = 1 }
files["/b/side.epub"] = { at = now - 400 * DAY, size = 1, sidecar = true }
table.insert(history, { file = "/b/read.epub" })
local catalog = { on_device_generation = 1, on_device = { [1] = "/b/old.epub", [2] = "/b/new.epub", [3] = "/b/read.epub", [4] = "/b/side.epub" } }
local list = BoardData.unopened(catalog, now)
assertEqual(#list, 2, "only never-opened books")
assertEqual(list[1].id .. "," .. list[2].id, "1,2", "oldest download first")

local books = { { id = 2, title = "New" }, { id = 1, title = "Old" } }
local seen = {}
for day = 0, 3 do
    local dust = BoardData.dust(catalog, books, now + day * DAY, 0)
    seen[day] = dust.book.id
end
assertEqual(seen[0] ~= seen[1], true, "a different book the next day")
assertEqual(seen[0], seen[2], "two books take turns")
local first = BoardData.dust(catalog, books, now, 0)
local skipped_one = BoardData.dust(catalog, books, now, 1)
assertEqual(first.book.id ~= skipped_one.book.id, true, "Show another moves to the next book")
assertEqual(first.count, 2, "counts the unopened books")
assertEqual(first.total_mb, 4, "and the room they take")
local old = first.book.id == 1 and first or skipped_one
assertEqual(old.months, 6, "two hundred days is six months")

-- A book opened since the list was made is passed over the same day.
table.insert(history, { file = "/b/" .. (first.book.id == 1 and "old" or "new") .. ".epub" })
local after = BoardData.dust(catalog, books, now, 0)
assertEqual(after.book.id ~= first.book.id, true, "an opened book drops out")
BoardData.invalidateUnopened()

print("bookorbit_board_decor_data_test.lua: ok")
