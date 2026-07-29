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
package.loaded["ui/uimanager"] = {}
package.loaded["ui/widget/verticalgroup"] = widgetClass()
package.loaded["ui/widget/verticalspan"] = widgetClass()
package.loaded["bookorbit_stats_reader"] = {}

local rendered_stats = {}
package.loaded["bookorbit_catalog_widgets"] = {
    buildDashboardStat = function(value, label, width)
        table.insert(rendered_stats, { value = value, label = label, width = width })
        return widgetClass():new()
    end,
}

local CatalogDashboard = require("bookorbit_catalog_dashboard")
CatalogDashboard.buildDashboardStatsStrip({
    content_w = 500,
    onDeviceCount = function()
        return 2
    end,
}, {
    today_seconds = 600,
    week_seconds = 3600,
    streak_days = 14,
}, {
    totalBooks = 99,
    readingStreak = { currentStreak = 20 },
})

assertEqual(rendered_stats[3].label, "Day streak", "dashboard renders a day streak stat")
assertEqual(rendered_stats[3].value, "20", "dashboard renders the account streak instead of the local streak")

print("bookorbit_catalog_streak_test.lua: ok")
