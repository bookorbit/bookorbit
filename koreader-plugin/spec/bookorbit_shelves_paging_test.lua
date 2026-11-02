-- Proves the Shelves page never squeezes a row below its own text: shelves a
-- screen cannot hold at a readable row run on to further pages, a section that
-- continues repeats its heading, and every shelf is shown exactly once.

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
    stringISO8601ToSeconds = function() return nil end,
}
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
package.loaded["ffi/blitbuffer"] = setmetatable({}, { __index = function() return 0 end })
package.loaded["ui/font"] = { getFace = function() return {} end }

-- A Kobo Libra: 1264 x 1680 at 300 dpi.
local screen = { w = 1264, h = 1680, dpi = 300 }
package.loaded["device"] = {
    hasFrontlight = function() return false end,
    screen = {
        getWidth = function() return screen.w end,
        getHeight = function() return screen.h end,
        getDPI = function() return screen.dpi end,
        scaleBySize = function(_, value)
            return math.ceil(value * math.min(screen.w, screen.h) / 600)
        end,
    },
}

G_reader_settings = { isTrue = function() return false end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ListData = require("bookorbit_list_data")
local BoardMetrics = require("bookorbit_board_metrics")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function assertTrue(value, label)
    if not value then error(label) end
end

-- Every shelf, in the order the pages show them, as "section:row".
local function shown(layout)
    local out = {}
    for _p, page in ipairs(layout.pages) do
        for _c, chunks in ipairs(page) do
            for _k, chunk in ipairs(chunks) do
                for i = chunk.from, chunk.to do table.insert(out, chunk.section .. ":" .. i) end
            end
        end
    end
    return out
end

local function expected(sizes)
    local out = {}
    for s, n in ipairs(sizes) do
        for i = 1, n do table.insert(out, s .. ":" .. i) end
    end
    return out
end

local function assertAllShownOnce(layout, sizes, label)
    assertEqual(table.concat(shown(layout), ","), table.concat(expected(sizes), ","), label .. ": every shelf shows once, in order")
end

local function assertColumnsFit(layout, o, label)
    for p, page in ipairs(layout.pages) do
        for c, chunks in ipairs(page) do
            local used = 0
            for k, chunk in ipairs(chunks) do
                used = used + (k > 1 and o.gap or 0) + o.head_h + (chunk.to - chunk.from + 1) * layout.row_h
            end
            assertTrue(used <= o.content_h, string.format("%s: page %d column %d is %d tall in %d", label, p, c, used, o.content_h))
        end
    end
end

local function opts(extra)
    local o = { content_h = 1000, head_h = 36, gap = 14, row_h = 72, min_row_h = 56, columns = { { 1, 2, 3 } }, cols = 1 }
    for k, v in pairs(extra or {}) do o[k] = v end
    return o
end

-- A few shelves keep their natural row on one page.
local sizes = { 1, 2, 1 }
local layout = ListData.shelfPages(sizes, opts())
assertEqual(#layout.pages, 1, "a few shelves stay on one page")
assertEqual(layout.row_h, 72, "at the natural row height")
assertAllShownOnce(layout, sizes, "few shelves")

-- Rows shrink toward the minimum before anything pages.
sizes = { 3, 8, 3 }
layout = ListData.shelfPages(sizes, opts())
assertEqual(#layout.pages, 1, "fourteen shelves still fit one page")
assertEqual(layout.row_h, math.floor((1000 - 3 * 36 - 2 * 14) / 14), "their rows share the room")
assertTrue(layout.row_h >= 56 and layout.row_h < 72, "between the minimum and the natural row")

-- One row more than the minimum allows pages instead of squeezing.
local fits = math.floor((1000 - 3 * 36 - 2 * 14) / 56)
sizes = { 3, fits - 3, 0 }
layout = ListData.shelfPages(sizes, opts())
assertEqual(#layout.pages, 1, "the most rows a page holds at the minimum stay on one page")
assertTrue(layout.row_h >= 56 and layout.row_h < 58, "at about the minimum")
sizes = { 3, fits - 2, 0 }
layout = ListData.shelfPages(sizes, opts())
assertTrue(#layout.pages > 1, "one more row pages")
assertEqual(layout.row_h, 56, "and never goes below the minimum")
assertAllShownOnce(layout, sizes, "boundary")
assertColumnsFit(layout, opts(), "boundary")

-- The reported library: 3 libraries, 27 collections, 15 scopes.
sizes = { 3, 27, 15 }
layout = ListData.shelfPages(sizes, opts())
assertTrue(#layout.pages > 1, "45 shelves run over several pages")
assertEqual(layout.row_h, 56, "at the minimum row")
assertAllShownOnce(layout, sizes, "reported library")
assertColumnsFit(layout, opts(), "reported library")
local first = layout.pages[1][1][1]
assertEqual(first.section .. ":" .. first.from, "1:1", "Libraries open the first page")
local second = layout.pages[2][1][1]
assertTrue(second.from > 1 or second.section > 1, "a later page continues where the last stopped")
for p = 2, #layout.pages do
    local chunk = layout.pages[p][1][1]
    assertTrue(chunk.to >= chunk.from, "a continuing section always has a row under its heading (page " .. p .. ")")
end

-- Two columns flow left to right, then on to the next page.
local wide = opts({ columns = { { 1 }, { 2, 3 } }, cols = 2 })
layout = ListData.shelfPages(sizes, wide)
assertTrue(#layout.pages > 1, "45 shelves page on a wide screen too")
assertTrue(#layout.pages < #ListData.shelfPages(sizes, opts()).pages, "two columns need fewer pages than one")
assertAllShownOnce(layout, sizes, "wide")
assertColumnsFit(layout, wide, "wide")
assertEqual(#layout.pages[1][2] > 0, true, "the second column fills before a page turns")

-- A wide page whose columns fit keeps the sections where they were.
sizes = { 3, 6, 4 }
layout = ListData.shelfPages(sizes, wide)
assertEqual(#layout.pages, 1, "a few shelves fit one wide page")
assertEqual(#layout.pages[1][1], 1, "Libraries have the left column")
assertEqual(#layout.pages[1][2], 2, "Collections and SmartScopes share the right")
assertAllShownOnce(layout, sizes, "wide fit")

-- Empty sections keep their heading and never break the flow.
layout = ListData.shelfPages({ 0, 0, 0 }, opts())
assertEqual(#layout.pages, 1, "no shelves at all is one page")
assertEqual(layout.pages[1][1][2].to, 0, "an empty section has no rows")
layout = ListData.shelfPages({ 0, 40, 0 }, opts())
assertAllShownOnce(layout, { 0, 40, 0 }, "only collections")
assertColumnsFit(layout, opts(), "only collections")

-- No section is left with a heading and no rows, however the page breaks.
for total = 1, 80 do
    local s = { 3, total, 15 }
    local l = ListData.shelfPages(s, opts())
    assertAllShownOnce(l, s, "sweep " .. total)
    assertColumnsFit(l, opts(), "sweep " .. total)
    for p, page in ipairs(l.pages) do
        for _c, chunks in ipairs(page) do
            for _k, chunk in ipairs(chunks) do
                assertTrue(chunk.to >= chunk.from or s[chunk.section] == 0, "sweep " .. total .. ": page " .. p .. " has a heading without rows")
            end
        end
    end
end

-- On the Libra itself the minimum row holds the two lines of a shelf's text.
local px, lh1 = BoardMetrics.px, BoardMetrics.lh1
local text_h = lh1(15) + px(2) + lh1(13)
assertTrue(px(56) >= text_h, string.format("a minimum row (%d) holds a title and its count (%d)", px(56), text_h))
local content_h = screen.h - px(6) - px(8) - px(64) - px(8) - px(40)
local libra = ListData.shelfPages({ 3, 27, 15 }, {
    content_h = content_h, head_h = px(36), gap = px(14), row_h = px(72), min_row_h = px(56),
    columns = { { 1, 2, 3 } }, cols = 1,
})
assertTrue(libra.row_h >= text_h, string.format("the reported library's rows (%d) are never shorter than their text (%d)", libra.row_h, text_h))
assertTrue(#libra.pages >= 2, "the reported library pages on a Libra")

print("bookorbit_shelves_paging_test.lua: ok")
