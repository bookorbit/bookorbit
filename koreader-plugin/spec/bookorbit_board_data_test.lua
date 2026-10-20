-- Proves the numbers the dashboard widgets show: the year of reading merged
-- from the server and this device, the week and today taken from it, the
-- streak, the finish forecast, and the labels for progress and dates.

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
local disk_calls = 0
package.loaded["util"] = {
    fixUtf8 = function(value) return value end,
    diskUsage = function()
        disk_calls = disk_calls + 1
        return { total = 8 * 1024 ^ 3, available = 2 * 1024 ^ 3 }
    end,
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
local connected = true
package.loaded["ui/network/manager"] = { isConnected = function() return connected end }

local daily_seconds = {}
local pace = nil
local habit_reads = 0
local hour_minutes = nil
local session_records = nil
package.loaded["bookorbit_stats_reader"] = {
    getDailySeconds = function() return daily_seconds end,
    getBookPace = function() return pace end,
    getHourMinutes = function() habit_reads = habit_reads + 1; return hour_minutes end,
    getSessionRecords = function() habit_reads = habit_reads + 1; return session_records end,
}
package.loaded["lua-ljsqlite3/init"] = false
package.loaded["datastorage"] = { getSettingsDir = function() return "/nonexistent" end }
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }

G_reader_settings = { isTrue = function() return false end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BoardData = require("bookorbit_board_data")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local DAY = 86400
-- A Wednesday afternoon, local time.
local now = os.time({ year = 2026, month = 10, day = 14, hour = 15 })
local function key(t) return os.date("%Y-%m-%d", t) end

local catalog = {
    settings = { username = "reader" },
    isOnDevice = function(_, book) return book.id == 1 end,
    thumbnailDisplay = function() return nil, "missing" end,
    onDeviceCount = function() return 3 end,
    boardBookMd5 = function() return "md5" end,
}

-- The heatmap is 52 whole weeks, Sunday to Saturday, ending with this week;
-- days after today are empty.
local values, start = BoardData.yearMinutes(now, nil)
assertEqual(#values <= BoardData.HEATMAP_DAYS, true, "the year never holds more than 52 weeks")
assertEqual(os.date("%w", start), "0", "the year starts on a Sunday")
local last
for i = 1, BoardData.HEATMAP_DAYS do
    if values[i] ~= nil then last = i end
end
assertEqual(key(start + (last - 1) * DAY), key(now), "the last filled day is today")
assertEqual(values[last + 1], nil, "days after today are empty")

-- Server and device minutes merge by taking the larger per day: the device may
-- hold reading not synced yet, the server holds other devices'.
BoardData.invalidateLocal()
daily_seconds = {
    [key(now)] = 30 * 60,
    [key(now - DAY)] = 10 * 60,
}
local server_start = BoardData.dayStart(now) - 370 * DAY + 12 * 3600
local minutes = {}
for i = 1, 371 do minutes[i] = 0 end
minutes[371] = 12
minutes[370] = 45
local d = BoardData.build(catalog, {
    dashboard = {
        readingYear = { startDate = key(server_start), minutes = minutes },
        readingStreak = { currentStreak = 0, longestStreak = 9, lastSevenDays = {} },
        readingGoal = { goalBooks = 24, completedBooks = 10, year = 2026 },
        continueReading = { { id = 1, progressPercentage = 50 }, { id = 2, progressPercentage = 99.7 } },
    },
}, now)
assertEqual(d.today_min, 30, "today takes the device's unsynced minutes over the server's")
assertEqual(d.week[6], 45, "yesterday takes the server's larger count")
assertEqual(d.week_min, 75, "the week sums its seven days")
assertEqual(d.streak.current, 1, "reading today counts toward a streak the server has not seen")
assertEqual(d.streak.longest, 9, "the longest streak comes from the server")
assertEqual(d.streak_week[7], true, "today is marked on the streak week")
assertEqual(d.goal.books .. "/" .. d.goal.done, "24/10", "the goal comes from the server")
assertEqual(d.continue_reading[1].on_device, true, "books are decorated with their device state")

-- The forecast divides what is left of the book by the recent daily pace.
pace = { seconds_per_page = 60, total_pages = 300, recent_seconds = 14 * 30 * 60 }
local f = BoardData.forecast({ progressPercentage = 50 }, "a", now)
assertEqual(math.floor(f.minutes_left + 0.5), 150, "half of a 300-page book at a minute a page is 150 minutes")
assertEqual(f.per_day, 30, "two weeks of 30 minutes a day is the pace")
assertEqual(f.days_out, 4, "150 minutes at 30 a day ends on the fifth day, four days out")
pace = { seconds_per_page = 60, total_pages = 300, recent_seconds = 0 }
f = BoardData.forecast({ progressPercentage = 50 }, "b", now)
assertEqual(f.per_day, 5, "a quiet fortnight still assumes five minutes a day")
pace = { seconds_per_page = 60, total_pages = 300, recent_seconds = 14 * 30 * 60 }
f = BoardData.forecast({ progressPercentage = 100 }, "c", now)
assertEqual(f.days_out .. " " .. f.day, "0 Today", "a finished book forecasts today")
assertEqual(BoardData.forecast({ progressPercentage = 10 }, nil, now), nil, "no forecast without the book's statistics")

-- Progress labels: a started book never reads 0%, an unfinished one never 100%.
assertEqual(BoardData.pctLabel({ progressPercentage = 0.2 }), "<1%", "a barely started book")
assertEqual(BoardData.pctLabel({ progressPercentage = 0 }), "0%", "an unstarted book")
assertEqual(BoardData.pctLabel({ progressPercentage = 42.5 }), "43%", "progress rounds")
assertEqual(BoardData.pctLabel({ progressPercentage = 99.7 }), "99%", "an unfinished book stops at 99%")
assertEqual(BoardData.pctLabel({ progressPercentage = 100 }), "100%", "a finished book")
assertEqual(BoardData.pctLabel({}), nil, "no progress, no label")

-- Durations and dates.
assertEqual(BoardData.formatDuration(45), "45 min", "under an hour")
assertEqual(BoardData.formatDuration(120), "2 h", "whole hours")
assertEqual(BoardData.formatDuration(135), "2 h 15 min", "hours and minutes")
assertEqual(BoardData.formatShortDuration(135), "2h 15m", "short form")
assertEqual(BoardData.partOfMonth("2025-09-10"):match("^Early") ~= nil, true, "the tenth is early in the month")
assertEqual(BoardData.partOfMonth("2025-09-11"):match("^Mid") ~= nil, true, "the eleventh is mid month")
assertEqual(BoardData.partOfMonth("2025-09-21"):match("^Late") ~= nil, true, "the twenty-first is late")
assertEqual(BoardData.partOfMonth("not a date"), nil, "junk has no label")
local function iso(t) return os.date("%Y-%m-%dT%H:%M:%S", t) end
assertEqual(BoardData.relativeDay(iso(now - 30), now), "just now", "seconds ago")
assertEqual(BoardData.relativeDay(iso(now - 600), now), "10 min ago", "minutes ago")
assertEqual(BoardData.relativeDay(iso(now - 3 * 3600), now), "3 h ago", "hours ago")
assertEqual(BoardData.relativeDay(iso(now - DAY - 3600), now), "yesterday", "the day before")

-- Hours and records read the device's whole recent history, so they are read
-- only when a widget asks, and once a day.
BoardData.invalidateHabits()
habit_reads = 0
hour_minutes = {}
for i = 1, 24 do hour_minutes[i] = i == 15 and 40 or 0 end
session_records = { sessions = 12, longest_seconds = 5340, average_seconds = 870, pages_per_hour = 37.6 }
d = BoardData.build(catalog, { dashboard = {} }, now)
assertEqual(habit_reads, 0, "building the board reads no habits")
assertEqual(d.hours[15], 40, "the hours are read when a widget asks")
assertEqual(d.records.longest_min .. "/" .. d.records.avg_min .. "/" .. d.records.pages_per_hour .. "/" .. d.records.sessions,
    "89/15/38/12", "records come back in whole minutes and pages")
assertEqual(habit_reads, 2, "each is read once")
d = BoardData.build(catalog, { dashboard = {} }, now + 3600)
local _hours, _records = d.hours, d.records
assertEqual(habit_reads, 2, "a later render the same day reuses them")
BoardData.invalidateHabits()
session_records = nil
d = BoardData.build(catalog, { dashboard = {} }, now)
assertEqual(d.records, false, "no reading on this device gives no records")

-- Finished this year comes with the dashboard; an older server sends none.
d = BoardData.build(catalog, { dashboard = { finishedThisYear = { { id = 7, title = "Done" } } } }, now)
assertEqual(d.shelves.finished[1].id, 7, "the finished books come from the dashboard body")
d = BoardData.build(catalog, { dashboard = {} }, now)
assertEqual(#d.shelves.finished, 0, "an older server leaves the shelf empty, not loading")

-- Pick back up captions show the month the book was put down.
assertEqual(BoardData.monthYear("2025-08-29T21:55:00Z"), "Aug 2025", "month and year")
assertEqual(BoardData.monthYear(nil), nil, "no date, no label")

-- The disk is measured at most once every couple of minutes.
disk_calls = 0
BoardData.storage("/books", now)
BoardData.storage("/books", now + 30)
assertEqual(disk_calls, 1, "a second render inside the window reuses the measurement")
BoardData.storage("/books", now + 600)
assertEqual(disk_calls, 2, "a later render measures again")

print("bookorbit_board_data_test.lua: ok")
