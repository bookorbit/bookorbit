package.loaded["document/documentregistry"] = {
    hasProvider = function()
        return true
    end,
}

package.loaded["util"] = {
    fixUtf8 = function(value)
        return value
    end,
}

package.loaded["ffi/util"] = {
    template = function(value)
        return value
    end,
}

package.loaded["gettext"] = function(text)
    return text
end

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogUtil = require("bookorbit_catalog_util")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

assertEqual(
    CatalogUtil.readingStreakDays({ readingStreak = { currentStreak = 20 } }, 14),
    20,
    "account streak overrides local streak"
)
assertEqual(
    CatalogUtil.readingStreakDays({ readingStreak = { currentStreak = 0 } }, 14),
    0,
    "zero account streak overrides local streak"
)
assertEqual(CatalogUtil.readingStreakDays({}, 14), 14, "missing account streak falls back to local streak")
assertEqual(CatalogUtil.readingStreakDays(nil, nil), 0, "missing streak data falls back to zero")

-- Relative labels pick their bucket from the delta; the stubbed template
-- returns the raw format string, which is enough to prove branch selection.
local now = os.time()
local function iso(timestamp)
    return os.date("!%Y-%m-%dT%H:%M:%S", timestamp) .. ".000Z"
end
assertEqual(CatalogUtil.formatRelativeTime(iso(now - 30), now), "just now", "a fresh timestamp reads as just now")
assertEqual(CatalogUtil.formatRelativeTime(iso(now - 300), now), "%1 min ago", "minutes bucket")
assertEqual(CatalogUtil.formatRelativeTime(iso(now - 7200), now), "%1 h ago", "hours bucket")
assertEqual(CatalogUtil.formatRelativeTime(iso(now - math.floor(1.5 * 86400)), now), "yesterday", "one day reads as yesterday")
assertEqual(CatalogUtil.formatRelativeTime(iso(now - 5 * 86400), now), "%1 days ago", "days bucket")
assertEqual(CatalogUtil.formatRelativeTime(iso(now + 3600), now), "just now", "a future timestamp clamps to just now")
assertEqual(CatalogUtil.formatRelativeTime("not a timestamp", now), nil, "junk yields no label")
assertEqual(CatalogUtil.formatRelativeTime(nil, now), nil, "nil yields no label")

local function widgetClass()
    return {
        new = function(_, opts)
            opts = opts or {}
            if not opts.getSize then
                function opts:getSize()
                    return { w = 100, h = 20 }
                end
            end
            return opts
        end,
    }
end

package.loaded["ffi/blitbuffer"] = {
    COLOR_DARK_GRAY = 1,
    COLOR_LIGHT_GRAY = 2,
}
package.loaded["ui/widget/button"] = widgetClass()
package.loaded["ui/widget/container/centercontainer"] = widgetClass()
package.loaded["ui/font"] = {
    getFace = function()
        return {}
    end,
}
package.loaded["ui/geometry"] = widgetClass()
package.loaded["ui/widget/horizontalgroup"] = widgetClass()
package.loaded["ui/widget/horizontalspan"] = widgetClass()
package.loaded["ui/widget/infomessage"] = widgetClass()
package.loaded["ui/widget/linewidget"] = widgetClass()
package.loaded["ui/network/manager"] = {}
package.loaded["device"] = {
    screen = {
        scaleBySize = function(_, value)
            return value
        end,
    },
}
package.loaded["ui/size"] = {
    line = { thin = 1 },
    padding = { large = 8 },
    span = {
        horizontal_default = 4,
        vertical_default = 4,
    },
}
package.loaded["ui/widget/textboxwidget"] = widgetClass()
package.loaded["ui/widget/textwidget"] = widgetClass()
package.loaded["ui/uimanager"] = {}
package.loaded["ui/widget/verticalgroup"] = widgetClass()
package.loaded["ui/widget/verticalspan"] = widgetClass()
package.loaded["bookorbit_stats_reader"] = {}

local rendered_stats = {}
package.loaded["bookorbit_catalog_widgets"] = {
    buildDashboardStat = function(value, label, width, extra, metrics)
        table.insert(rendered_stats,
            { value = value, label = label, width = width, extra = extra, metrics = metrics })
        return widgetClass():new()
    end,
    dashboardStatMetrics = function(spark_h)
        return { value_h = 20, label_h = 10, spark_h = spark_h or 0, gap = 4, total_h = 34 }
    end,
    buildDashboardWeekBar = function()
        return widgetClass():new()
    end,
    buildDashboardWeekChart = function(bars)
        return bars
    end,
    buildDashboardStatIcon = function(asset_name)
        return widgetClass():new{ asset_name = asset_name }
    end,
}

local CatalogDashboard = require("bookorbit_catalog_dashboard")

local function newStripCatalog()
    local catalog = { content_w = 500 }
    for name, fn in pairs(CatalogDashboard) do
        if name ~= "install" then catalog[name] = fn end
    end
    return catalog
end

local catalog = newStripCatalog()
catalog:buildDashboardStatsStrip({
    today_seconds = 600,
    week_seconds = 3600,
    streak_days = 14,
}, {
    totalBooks = 99,
    readingStreak = { currentStreak = 20 },
})

assertEqual(#rendered_stats, 3, "without a goal the strip keeps to the three activity blocks")
assertEqual(rendered_stats[1].label, "Today", "dashboard renders a today stat")
assertEqual(rendered_stats[1].value, "%1 min", "an empty day renders as minutes, not prose")
-- No per-day data means no chart, but the block still takes the fallback icon
-- rather than becoming the one empty slot in the strip.
assertEqual(rendered_stats[2].extra.asset_name, "stat_week",
    "without per-day data the week block falls back to its icon")
assertEqual(rendered_stats[3].label, "Day streak", "dashboard renders a day streak stat")
assertEqual(rendered_stats[3].value, "20", "dashboard renders the account streak instead of the local streak")

-- With per-day activity and a yearly goal the strip gains the bars and a
-- fourth block; inventory counts stay out of it.
rendered_stats = {}
catalog = newStripCatalog()
catalog:buildDashboardStatsStrip({
    today_seconds = 600,
    week_seconds = 3600,
    day_seconds = { 0, 600, 0, 1200, 0, 900, 600 },
    streak_days = 14,
}, {
    totalBooks = 99,
    readingStreak = { currentStreak = 20 },
    readingGoal = { goalBooks = 24, completedBooks = 12, year = 2026 },
})

assertEqual(#rendered_stats, 4, "a yearly goal adds a fourth block")
assertEqual(rendered_stats[2].extra ~= nil, true, "per-day activity renders the bars")
assertEqual(rendered_stats[4].value, "12 / 24", "the goal block shows progress toward the yearly goal")

-- Every block is laid out against one set of row heights, which is what keeps
-- the values on a single baseline and the labels on another even though only
-- the "Past 7 days" block carries a sparkline.
for index, block in ipairs(rendered_stats) do
    assertEqual(block.metrics, rendered_stats[1].metrics,
        "block " .. index .. " shares the strip's row metrics")
end
assertEqual(rendered_stats[1].metrics.spark_h > 0, true,
    "blocks without a sparkline still reserve its row")

-- Every block puts something in that row: the chart for "Past 7 days", an icon
-- for the rest, so three of the four do not render as an empty gap.
for index, block in ipairs(rendered_stats) do
    assertEqual(block.extra ~= nil, true, "block " .. index .. " carries a marker")
end
assertEqual(rendered_stats[1].extra.asset_name, "stat_today", "the today block takes the clock")
assertEqual(rendered_stats[3].extra.asset_name, "stat_streak", "the streak block takes the flame")
assertEqual(rendered_stats[4].extra.asset_name, "stat_goal", "the goal block takes the target")
for _, block in ipairs(rendered_stats) do
    assertEqual(block.label == "Library" or block.label == "On device", false,
        "inventory counts no longer render in the strip")
end

print("bookorbit_catalog_streak_test.lua: ok")
