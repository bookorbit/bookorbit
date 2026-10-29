-- Proves the rules the list pages follow: what a status cell and a grid
-- caption say, how a list groups entries under letters, how a series counts,
-- what an author row shows, and how a provider's glued bio prefix is dropped.

package.loaded["gettext"] = function(text)
    return text
end
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}
package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    fixUtf8 = function(value) return value end,
    diskUsage = function() return { total = 1, available = 1 } end,
}
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
package.loaded["bookorbit_stats_reader"] = {
    getDailySeconds = function() return {} end,
    getBookPace = function() return nil end,
    getHourMinutes = function() return nil end,
    getSessionRecords = function() return nil end,
}
package.loaded["lua-ljsqlite3/init"] = false
package.loaded["datastorage"] = { getSettingsDir = function() return "/nonexistent" end }
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }

G_reader_settings = { isTrue = function() return false end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ListData = require("bookorbit_list_data")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function joined(parts)
    local out = {}
    for _i, p in ipairs(parts) do table.insert(out, p.t) end
    return table.concat(out)
end

-- ------------------------------------------------------------------ state
assertEqual(ListData.stateOf({ readStatus = "read" }), "finished", "read is finished")
assertEqual(ListData.stateOf({ readStatus = "rereading" }), "reading", "rereading is reading")
assertEqual(ListData.stateOf({ readStatus = "on_hold" }), "paused", "on hold is paused")
assertEqual(ListData.stateOf({ progressPercentage = 40 }), "reading", "progress without a status reads as reading")
assertEqual(ListData.stateOf({ progressPercentage = 100 }), "unread", "a full bar without a status is not reading")
assertEqual(ListData.stateOf({}), "unread", "nothing known is unread")

assertEqual(ListData.pctLabel({ progressPercentage = 0.2 }), "<1%", "a started book never shows 0%")
assertEqual(ListData.pctLabel({ progressPercentage = 99.7 }), "99%", "an unfinished book never rounds up to 100%")
assertEqual(ListData.pctLabel({ progressPercentage = 33.5 }), "34%", "percentages round to the nearest")
assertEqual(ListData.pctLabel({}), nil, "no progress has no label")

-- ------------------------------------------------------------- letters
assertEqual(ListData.letterOf("  dune"), "D", "leading spaces are skipped and the letter is upper-cased")
assertEqual(ListData.letterOf("Émile"), "E", "Latin accents fold to their letter")
assertEqual(ListData.letterOf("1984"), "#", "digits group under #")
assertEqual(ListData.letterOf(nil), "#", "a missing key groups under #")
assertEqual(ListData.letterRange({ "A" }), "A", "one letter is itself")
assertEqual(ListData.letterRange({ "A", "B", "C" }), "A – C", "a run shows its ends")
assertEqual(ListData.letterRange({}), nil, "no letters, no range")
local letters = ListData.lettersOf({ { t = "Abe" }, { t = "Ann" }, { t = "Bo" } }, function(e) return ListData.letterOf(e.t) end)
assertEqual(table.concat(letters, ","), "A,B", "each letter is listed once, in order")
local present = ListData.presentLetters({ { key = "A", index = 0 }, { key = "C", index = 12 } })
assertEqual(present.C, 12, "a bucket keeps its offset")
assertEqual(present.B, nil, "a letter without a bucket is absent")

-- ----------------------------------------------------------- status cell
local reading = { readStatus = "reading", progressPercentage = 42, lastReadAt = "2026-10-11T09:00:00Z" }
local cell = ListData.statusCell(reading, { minutes_left = 265 })
assertEqual(cell.kind, "reading", "a reading book shows progress")
assertEqual(cell.label, "42%", "with its percentage")
assertEqual(cell.bottom, "4 h 25 min left", "and the time left when KOReader can forecast it")
assertEqual(ListData.statusCell({ readStatus = "rereading", progressPercentage = 7 }).bottom, "Rereading", "a reread says so")
local finished = ListData.statusCell({ readStatus = "read", lastReadAt = "2026-10-01T09:00:00Z" })
assertEqual(finished.label, "Read", "a finished book says Read")
assertEqual(ListData.statusCell({ formats = { "epub", "mobi" } }).label, "EPUB · MOBI", "an unread book shows its formats")
assertEqual(ListData.statusCell({ formats = { "epub", "m4b" } }).bottom, "with audio", "and whether it has audio")

assertEqual(joined(ListData.bookMeta(reading, { minutes_left = 65 })), "42% · 1h 5m left", "a grid caption keeps the short time left")
assertEqual(joined(ListData.bookMeta({ readStatus = "rereading", progressPercentage = 84 })), "84% · rereading", "a reread in a grid")
assertEqual(joined(ListData.bookMeta({ authors = { "Ezra Klein" } })), "Ezra Klein", "an unread book in a grid names its author")
assertEqual(joined(ListData.bookMeta({ authors = { "X" }, formats = { "epub", "pdf" } }, { author = false })), "EPUB, PDF", "or its formats where the author is the page")

-- ------------------------------------------------------- distinct titles
local short = ListData.distinctTitles({
    { id = 1, title = "Harry Potter and the Sorcerer's Stone" },
    { id = 2, title = "Harry Potter and the Chamber of Secrets" },
})
assertEqual(short[1], "Sorcerer's Stone", "a shared opening is dropped")
assertEqual(short[2], "Chamber of Secrets", "from every title")
local kept = ListData.distinctTitles({ { id = 1, title = "Dune" }, { id = 2, title = "Dune Messiah" } })
assertEqual(kept[2], "Dune Messiah", "one shared word is not enough to drop")

-- ---------------------------------------------------------------- series
assertEqual(ListData.seriesCounts({ count = 1, expectedCount = 5 }), "1 of 5 books", "a series knows it is incomplete")
assertEqual(ListData.seriesCounts({ count = 3 }), "3 books", "else it counts what is here")
assertEqual(ListData.seriesWho({ authorNames = { "Scott Snyder", "James Tynion" } }), "Scott Snyder and others", "several authors collapse")
local progress = ListData.seriesProgress({ count = 3, memberStates = { "finished", "reading", "unread" } })
assertEqual(progress.finished, 1, "finished members are counted from their states")
assertEqual(progress.reading, 1, "as are reading ones")
assertEqual(ListData.seriesBarLabel(progress), "1 of 3 read", "the bar says how far through")
assertEqual(ListData.seriesBarLabel(ListData.seriesProgress({ count = 2, finishedCount = 2, readingCount = 0 })), "All 2 read", "a finished series says so")

-- --------------------------------------------------------------- authors
assertEqual(ListData.authorCell({ count = 2 }), nil, "an untouched author has no status")
local one = ListData.authorCell({ count = 1, readingCount = 1, previewBooks = { { progressPercentage = 16, readStatus = "reading" } } })
assertEqual(one.bottom, "16% read", "one book being read shows its progress")
assertEqual(ListData.authorCell({ count = 3, finishedCount = 3 }).bottom, "all 3", "every book read")
assertEqual(ListData.authorCell({ count = 4, finishedCount = 1 }).label, "1 of 4", "some books read")
assertEqual(ListData.authorSecond({ count = 1, seriesName = "Julia Z" }), "1 book · Julia Z", "the second line names a series")
local variants = ListData.authorMetaVariants({ count = 2, readingCount = 2 })
assertEqual(joined(variants[1]), "2 books · 2 reading", "the richest caption comes first")
assertEqual(joined(variants[2]), "Reading 2 of 2", "a shorter one follows for narrow cells")

-- ------------------------------------------------------------------- bio
assertEqual(ListData.cleanBio("See also: Robert GalbraithAlthough she writes"), "Although she writes", "a glued See also line is dropped")
assertEqual(ListData.cleanBio("  Born in 1965."), "Born in 1965.", "leading space is trimmed")
assertEqual(ListData.cleanBio("   "), nil, "an empty bio is none")
assertEqual(ListData.cleanBio(nil), nil, "no bio is none")

-- ---------------------------------------------------------------- paging
local rows = ListData.fillRows(1000, 118)
assertEqual(rows.n, 8, "as many rows as fit at the minimum height")
assertEqual(rows.rh, 125, "stretched to fill the height exactly")
assertEqual(ListData.pageOf(0, 11), 1, "the first entry is on page 1")
assertEqual(ListData.pageOf(11, 11), 2, "the twelfth starts page 2")
assertEqual(ListData.pageOf(5, 0), 1, "an unknown page size falls back to page 1")

-- Paging around the first entry on screen, so a new page size keeps it first.
local w = ListData.windowPaging(44, 12, 488)
assertEqual(w.page, 5, "four pages lie before entry 44 at 12 a page")
assertEqual(w.pages, 41, "and the rest of 488 needs 37 more")
assertEqual(w.has_prev and w.has_next, true, "a page in the middle has both neighbours")
w = ListData.windowPaging(44, 11, 488)
assertEqual(w.page, 5, "entry 44 starts page 5 at 11 a page")
assertEqual(w.pages, 45, "and 488 entries make 45 pages")
w = ListData.windowPaging(0, 12, 488)
assertEqual(w.page .. "/" .. w.pages, "1/41", "the start of the list is page 1 of the whole count")
assertEqual(w.has_prev, false, "with nothing before it")
w = ListData.windowPaging(480, 12, 488)
assertEqual(w.page .. "/" .. w.pages, "41/41", "the last page is the last")
assertEqual(w.has_next, false, "with nothing after it")
w = ListData.windowPaging(5, 12, nil, true)
assertEqual(w.pages, nil, "an unknown total leaves the count open")
assertEqual(w.has_next, true, "and trusts the server's next")

local share = ListData.shareRows(8, { 242, 5, 12 })
assertEqual(table.concat(share, ","), "3,3,2", "eight rows split evenly, the spare ones to the first sections")
share = ListData.shareRows(8, { 242, 1, 12 })
assertEqual(table.concat(share, ","), "4,1,3", "a section never takes more rows than it holds")
share = ListData.shareRows(3, { 10, 10, 10 })
assertEqual(table.concat(share, ","), "1,1,1", "every section gets one row before any gets two")
share = ListData.shareRows(9, { 1, 2 })
assertEqual(table.concat(share, ","), "1,2", "rows left over stay unused")

print("bookorbit_list_data_test.lua: ok")
