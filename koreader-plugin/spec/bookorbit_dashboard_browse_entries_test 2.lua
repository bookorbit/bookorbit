-- The Browse block is a fixed three-by-three grid, so its entry list has to
-- stay exactly nine long: a tenth destination would be built and then fall off
-- the bottom of the block unseen. Search is not among them because the title
-- bar already carries a search button on every non-detail page, the same reason
-- the non-dashboard root list has never offered it as a row.

package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    fixUtf8 = function(value) return value end,
    urlEncode = function(value) return value end,
}
package.loaded["ffi/util"] = { template = function(value) return value end }
package.loaded["gettext"] = function(text) return text end

local function widgetClass(height)
    return {
        new = function(_, opts)
            opts = opts or {}
            if not opts.getSize then
                function opts:getSize()
                    return { w = 100, h = self.width or height or 20 }
                end
            end
            return opts
        end,
    }
end

package.loaded["ffi/blitbuffer"] = { COLOR_DARK_GRAY = 1, COLOR_LIGHT_GRAY = 2 }
package.loaded["ui/widget/button"] = widgetClass()
package.loaded["ui/widget/container/centercontainer"] = widgetClass()
package.loaded["ui/font"] = { getFace = function() return {} end }
package.loaded["ui/geometry"] = widgetClass()
package.loaded["ui/widget/horizontalgroup"] = widgetClass(0)
package.loaded["ui/widget/horizontalspan"] = widgetClass(0)
package.loaded["ui/widget/infomessage"] = widgetClass()
package.loaded["ui/widget/linewidget"] = widgetClass()
package.loaded["ui/network/manager"] = { isConnected = function() return true end }
package.loaded["device"] = { screen = { scaleBySize = function(_, value) return value end } }
package.loaded["ui/size"] = {
    line = { thin = 1 },
    padding = { large = 8 },
    span = { horizontal_default = 4, vertical_default = 4 },
}
package.loaded["ui/widget/textboxwidget"] = widgetClass()
package.loaded["ui/widget/textwidget"] = widgetClass()
package.loaded["ui/uimanager"] = { show = function() end }
package.loaded["ui/widget/verticalgroup"] = widgetClass(0)
package.loaded["ui/widget/verticalspan"] = widgetClass()
package.loaded["bookorbit_stats_reader"] = {
    getReadingSummary = function()
        return { today_seconds = 0, week_seconds = 0, streak_days = 0 }
    end,
}
package.loaded["bookorbit_catalog_widgets"] = {
    DashboardCoverCard = widgetClass(),
    DashboardHeroCard = widgetClass(),
    DashboardHighlightCard = widgetClass(),
    DashboardBrowseRow = widgetClass(),
    DashboardIconButton = widgetClass(),
    assetIconFile = function(name) return "/assets/" .. name .. ".svg" end,
    dashboardSectionHeaderRowHeight = function() return 14 end,
    buildDashboardSectionHeader = function()
        return { getSize = function() return { w = 100, h = 20 } end }
    end,
    buildStatusLabel = function()
        return { getSize = function() return { w = 100, h = 16 } end }
    end,
    dashboardHighlightCardHeight = function() return 64 end,
    coverCardHeight = function(card_w) return card_w + 20 end,
    dashboardHeroHeightForCoverCard = function(card_w) return card_w + 24 end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogDashboard = require("bookorbit_catalog_dashboard")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local catalog = {}
for name, fn in pairs(CatalogDashboard) do
    if name ~= "install" then catalog[name] = fn end
end
function catalog:onDeviceCount() return 7 end

local BROWSE_COUNTS = {
    inProgress = 4,
    libraries = 3,
    authors = 812,
    series = 96,
    collections = 5,
    smartScopes = 2,
}

local entries = catalog:dashboardActionEntries(120, BROWSE_COUNTS)

-- Three columns by three rows. The block renders what fits and no more.
assertEqual(#entries, 9, "the Browse block holds exactly nine destinations")

local by_text = {}
local by_kind = {}
for index, entry in ipairs(entries) do
    assertEqual(type(entry.text), "string", "entry " .. index .. " is labelled")
    assertEqual(entry.text ~= "", true, "entry " .. index .. " has a non-empty label")
    assertEqual(entry.icon ~= nil, true, "entry " .. index .. " has a fallback glyph")
    assertEqual(by_text[entry.text], nil, "entry " .. index .. " is not a duplicate label")
    by_text[entry.text] = entry
    by_kind[entry.kind] = (by_kind[entry.kind] or 0) + 1
end

-- The title bar's search button reaches the same prompt with the same empty
-- scope, so a row for it only spent a grid cell.
assertEqual(by_text["Search"], nil, "Search is not duplicated into the grid")
assertEqual(by_kind["dashboard-search"], nil, "no entry routes to the search prompt")

-- The pair the download workflow is built around: what is here, and what is not.
assertEqual(by_text["On device"] ~= nil, true, "On device is offered")
assertEqual(by_text["On device"].kind, "on-device", "On device routes to the linked list")
assertEqual(by_text["On device"].mandatory, "7", "On device carries its count")

assertEqual(by_text["Not on device"] ~= nil, true, "Not on device is offered")
assertEqual(by_text["Not on device"].kind, "not-on-device", "Not on device routes to the walk")
-- The count would cost a full library walk to learn, so the row stays quiet
-- rather than showing a number that is only a guess.
assertEqual(by_text["Not on device"].mandatory, nil, "Not on device shows no count")
assertEqual(
    by_text["Not on device"].icon_file ~= by_text["On device"].icon_file,
    true,
    "the two device rows are told apart by their icons"
)

-- The catalogs reached through the grid still are.
for _, label in ipairs({ "In progress", "Libraries", "All Books", "Authors", "Series", "Collections", "SmartScopes" }) do
    assertEqual(by_text[label] ~= nil, true, label .. " survived the swap")
end
assertEqual(by_text["All Books"].mandatory, "120", "All Books carries the library total")

-- Every tile the server can count carries its badge. Eight of the nine: the
-- device pair is local, All Books rides the dashboard total, and the rest come
-- from the browse counts.
assertEqual(by_text["In progress"].mandatory, "4", "In progress badge")
assertEqual(by_text["Libraries"].mandatory, "3", "Libraries badge")
assertEqual(by_text["Authors"].mandatory, "812", "Authors badge")
assertEqual(by_text["Series"].mandatory, "96", "Series badge")
assertEqual(by_text["Collections"].mandatory, "5", "Collections badge")
assertEqual(by_text["SmartScopes"].mandatory, "2", "SmartScopes badge")

local badged = 0
for _, entry in ipairs(entries) do
    if entry.mandatory ~= nil then badged = badged + 1 end
end
assertEqual(badged, 8, "eight of the nine tiles can be counted")

-- Zero is a real answer and has to render, not be swallowed as falsy the way a
-- plain truthiness check on the count would.
local empty = catalog:dashboardActionEntries(0, {
    inProgress = 0, libraries = 0, authors = 0, series = 0, collections = 0, smartScopes = 0,
})
for _, entry in ipairs(empty) do
    if entry.kind ~= "not-on-device" then
        assertEqual(entry.mandatory ~= nil, true, entry.text .. " renders a zero count")
    end
end

-- A server too old to send the counts, and a server that sends nonsense, both
-- degrade to unbadged tiles rather than rendering "nil" into the grid.
for _, payload in ipairs({ { nil }, { "not a table" }, { { authors = "many", series = {} } } }) do
    local degraded = catalog:dashboardActionEntries(nil, payload[1])
    assertEqual(#degraded, 9, "the grid is still full")
    for _, entry in ipairs(degraded) do
        if entry.kind ~= "on-device" then
            assertEqual(entry.mandatory, nil, entry.text .. " has no badge without usable counts")
        end
    end
end

-- Badges share a narrow column with the label, so the string is bounded at four
-- characters however large the library gets.
local CatalogUtil = require("bookorbit_catalog_util")
local formatCount = CatalogUtil.formatCount

assertEqual(formatCount(0), "0", "zero is a count, not an absence")
assertEqual(formatCount(7), "7", "single digit")
assertEqual(formatCount(999), "999", "the last unscaled value")
assertEqual(formatCount(1000), "1K", "a whole thousand drops its decimal")
assertEqual(formatCount(1500), "1.5K", "a half thousand keeps one decimal")
assertEqual(formatCount(9999), "9.9K", "just under ten thousand")
assertEqual(formatCount(10000), "10K", "ten thousand and up lose the decimal")
assertEqual(formatCount(12431), "12K", "a large library")
assertEqual(formatCount(999999), "999K", "the last value before millions")
assertEqual(formatCount(1000000), "1M", "millions scale again")
assertEqual(formatCount(1500000), "1.5M", "millions keep one decimal")

-- Truncating, not rounding: a badge must never claim more books than are there,
-- and rounding 999999 up would carry it to a five-character "1000K".
assertEqual(formatCount(1999), "1.9K", "the scaled value truncates")
assertEqual(formatCount(1099), "1K", "truncation can drop the decimal entirely")

for _, value in ipairs({ 0, 7, 999, 1000, 1500, 9999, 10000, 999999, 1000000, 1500000 }) do
    assertEqual(#formatCount(value) <= 4, true, "the badge for " .. value .. " fits the column")
end

-- Anything that is not a usable count leaves the tile unbadged rather than
-- rendering a placeholder into the grid.
for _, value in ipairs({ "many", -1 }) do
    assertEqual(formatCount(value), nil, "unusable count " .. tostring(value) .. " has no badge")
end
assertEqual(formatCount(nil), nil, "a missing count has no badge")
assertEqual(formatCount({}), nil, "a malformed count has no badge")

-- A count arriving as a numeric string still counts, since the payload is JSON.
assertEqual(formatCount("1500"), "1.5K", "a numeric string is accepted")

print("bookorbit_dashboard_browse_entries_test.lua: ok")
